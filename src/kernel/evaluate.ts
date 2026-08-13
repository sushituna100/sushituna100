/**
 * Timeline evaluator: replays a document's feature list and produces solid
 * bodies as triangle meshes. Booleans run through three-bvh-csg (BVH-accelerated
 * mesh CSG). All body geometry is kept baked in world space.
 */

import * as THREE from "three";
import { ShapeUtils } from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import { evalExpr, resolveParameters } from "./expr";
import { buildProfile, planeMatrix, planeNormal } from "./sketch";
import type {
  BooleanOp,
  CadDocument,
  Expr,
  Feature,
  LoftFeature,
  PatternFeature,
  PlaneName,
  ShellFeature,
  SketchEntity,
  SketchFeature,
} from "./types";

export interface EvaluatedBody {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
}

export interface EvaluatedSketch {
  id: string;
  name: string;
  /** Closed outlines in world space, for viewport display. */
  outlines: THREE.Vector3[][];
}

export interface FeatureError {
  featureId: string;
  message: string;
}

export interface EvaluationResult {
  bodies: EvaluatedBody[];
  sketches: EvaluatedSketch[];
  errors: FeatureError[];
  /** Resolved parameter table used for this evaluation. */
  params: Record<string, number>;
}

const csg = new Evaluator();
csg.useGroups = false;

function opConst(op: "join" | "cut" | "intersect"): number {
  return op === "join" ? ADDITION : op === "cut" ? SUBTRACTION : INTERSECTION;
}

/** Signed volume of a triangle mesh (positive = outward-facing winding). */
function signedVolume(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute("position");
  const idx = geom.getIndex();
  let vol = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    vol += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
  }
  return vol;
}

/** Reverse triangle winding and flip normals in place. */
function flipWinding(geom: THREE.BufferGeometry): void {
  const idx = geom.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, t);
    }
    idx.needsUpdate = true;
  } else {
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i + 1),
        y = pos.getY(i + 1),
        z = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x, y, z);
    }
    pos.needsUpdate = true;
  }
  const nrm = geom.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) {
      nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    }
    nrm.needsUpdate = true;
  }
}

/** Ensure outward-facing winding (positive enclosed volume). */
function ensureOutward(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  if (signedVolume(geom) < 0) flipWinding(geom);
  return geom;
}

/** Apply a matrix, fixing winding/normals if the matrix mirrors (negative determinant). */
function applyMatrixFixed(geom: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  geom.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(geom);
  return geom;
}

function toBrush(geom: THREE.BufferGeometry): Brush {
  const brush = new Brush(geom);
  brush.updateMatrixWorld(true);
  return brush;
}

function runCsg(
  target: THREE.BufferGeometry,
  tool: THREE.BufferGeometry,
  op: "join" | "cut" | "intersect",
): THREE.BufferGeometry {
  const result = csg.evaluate(toBrush(target), toBrush(tool), opConst(op));
  // three-bvh-csg carries correct brush normals through the clip; recomputing
  // them here would smooth across unrelated faces and cause shading artifacts.
  return result.geometry;
}

interface BodyState {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
}

export function evaluateDocument(doc: CadDocument): EvaluationResult {
  const errors: FeatureError[] = [];
  const bodies = new Map<string, BodyState>();
  const sketchFeatures = new Map<string, SketchFeature>();
  const sketchOutlines: EvaluatedSketch[] = [];

  let params: Record<string, number> = {};
  try {
    params = resolveParameters(doc.parameters);
  } catch (err) {
    errors.push({ featureId: "$parameters", message: String((err as Error).message ?? err) });
    return { bodies: [], sketches: [], errors, params };
  }

  const n = (x: Expr) => evalExpr(x, params);

  /** Merge a freshly created solid into the model according to the feature's boolean op. */
  function integrate(
    feature: { id: string; name?: string; op: BooleanOp; target?: string },
    geom: THREE.BufferGeometry,
    defaultName: string,
  ): void {
    if (feature.op === "new" || bodies.size === 0) {
      bodies.set(feature.id, {
        id: feature.id,
        name: feature.name ?? defaultName,
        geometry: geom,
      });
      return;
    }
    const targetId = feature.target ?? [...bodies.keys()][0];
    const target = bodies.get(targetId);
    if (!target) throw new Error(`Target body "${targetId}" not found`);
    target.geometry = runCsg(target.geometry, geom, feature.op === "join" ? "join" : feature.op);
  }

  for (const feature of doc.features) {
    if (feature.suppressed) continue;
    try {
      evaluateFeature(feature);
    } catch (err) {
      errors.push({ featureId: feature.id, message: String((err as Error).message ?? err) });
    }
  }

  function evaluateFeature(feature: Feature): void {
    switch (feature.type) {
      case "sketch": {
        sketchFeatures.set(feature.id, feature);
        const m = planeMatrix(feature.plane.plane, feature.plane.offset ? n(feature.plane.offset) : 0);
        const { shapes } = buildProfile(feature, params);
        const outlines: THREE.Vector3[][] = [];
        for (const shape of shapes) {
          for (const path of [shape as THREE.Path, ...shape.holes]) {
            const pts2 = path.getPoints(48);
            const pts3 = pts2.map((p) => new THREE.Vector3(p.x, p.y, 0).applyMatrix4(m));
            if (pts3.length > 1) pts3.push(pts3[0].clone());
            outlines.push(pts3);
          }
        }
        sketchOutlines.push({ id: feature.id, name: feature.name ?? "Sketch", outlines });
        break;
      }

      case "extrude": {
        const sk = sketchFeatures.get(feature.sketch);
        if (!sk) throw new Error(`Sketch "${feature.sketch}" not found (must appear earlier in the timeline)`);
        const dist = n(feature.distance);
        if (dist <= 0) throw new Error("Extrude distance must be > 0");
        const { shapes } = buildProfile(sk, params);

        let geom: THREE.BufferGeometry;
        const draftDeg = feature.draftAngle ? n(feature.draftAngle) : 0;
        if (draftDeg !== 0) {
          if (shapes.length !== 1 || shapes[0].holes.length > 0) {
            throw new Error("draftAngle is only supported on a single hole-free profile in this version");
          }
          const shape = shapes[0];
          const pts = shape.getPoints(64);
          const centroid = new THREE.Vector2();
          for (const p of pts) centroid.add(p);
          centroid.divideScalar(pts.length);
          const avgR = pts.reduce((s, p) => s + p.distanceTo(centroid), 0) / pts.length;
          const delta = dist * Math.tan((draftDeg * Math.PI) / 180);
          const scale = 1 - delta / avgR;
          if (scale < 0.05) throw new Error("draftAngle too steep for this profile/depth (would collapse to a point)");
          geom = buildLoftedSolid([
            { shape, height: 0 },
            { shape: scaleShapeAboutCentroid(shape, scale), height: dist },
          ]);
        } else {
          geom = new THREE.ExtrudeGeometry(shapes, { depth: dist, bevelEnabled: false, curveSegments: 24 });
        }

        const dir = feature.direction ?? 1;
        if (dir === -1) geom.translate(0, 0, -dist);
        else if (dir === "symmetric") geom.translate(0, 0, -dist / 2);
        const planeOffset = sk.plane.offset ? n(sk.plane.offset) : 0;
        applyMatrixFixed(geom, planeMatrix(sk.plane.plane, planeOffset));
        ensureOutward(geom);
        integrate(feature, geom, "Extrude");
        break;
      }

      case "revolve": {
        const sk = sketchFeatures.get(feature.sketch);
        if (!sk) throw new Error(`Sketch "${feature.sketch}" not found (must appear earlier in the timeline)`);
        const angle = feature.angle === undefined ? 360 : n(feature.angle);
        if (Math.abs(angle - 360) > 1e-6) {
          throw new Error("Only full 360° revolves are supported in this version");
        }
        const axisOffset = feature.axisOffset ? n(feature.axisOffset) : 0;
        const { shapes } = buildProfile(sk, params);
        const planeOffset = sk.plane.offset ? n(sk.plane.offset) : 0;
        const planeM = planeMatrix(sk.plane.plane, planeOffset);

        let solid: THREE.BufferGeometry | null = null;
        for (const shape of shapes) {
          let geom = latheFromContour(shape.getPoints(64), feature.axis, axisOffset);
          for (const hole of shape.holes) {
            const holeGeom = latheFromContour(hole.getPoints(64), feature.axis, axisOffset);
            geom = runCsg(geom, holeGeom, "cut");
          }
          solid = solid ? runCsg(solid, geom, "join") : geom;
        }
        if (!solid) throw new Error("Revolve produced no geometry");
        applyMatrixFixed(solid, planeM);
        ensureOutward(solid);
        integrate(feature, solid, "Revolve");
        break;
      }

      case "primitive": {
        const s = feature.size.map(n);
        let geom: THREE.BufferGeometry;
        switch (feature.kind) {
          case "box":
            if (s.length < 3 || s.some((v) => v <= 0)) throw new Error("Box needs positive [w,d,h]");
            geom = new THREE.BoxGeometry(s[0], s[1], s[2]);
            break;
          case "cylinder":
            if (s.length < 2 || s.some((v) => v <= 0)) throw new Error("Cylinder needs positive [radius,height]");
            geom = new THREE.CylinderGeometry(s[0], s[0], s[1], 48);
            geom.rotateX(Math.PI / 2); // axis → Z
            break;
          case "sphere":
            if (s.length < 1 || s[0] <= 0) throw new Error("Sphere needs positive [radius]");
            geom = new THREE.SphereGeometry(s[0], 40, 28);
            break;
          case "torus":
            if (s.length < 2 || s.some((v) => v <= 0)) throw new Error("Torus needs positive [radius,tube]");
            geom = new THREE.TorusGeometry(s[0], s[1], 24, 64);
            break;
        }
        const m = new THREE.Matrix4();
        if (feature.rotate) {
          const [rx, ry, rz] = feature.rotate.map(n);
          m.makeRotationFromEuler(
            new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, "XYZ"),
          );
        }
        if (feature.at) {
          const [x, y, z] = feature.at.map(n);
          m.setPosition(x, y, z);
        }
        geom.applyMatrix4(m);
        integrate(feature, geom, feature.kind[0].toUpperCase() + feature.kind.slice(1));
        break;
      }

      case "combine": {
        const target = bodies.get(feature.target);
        if (!target) throw new Error(`Target body "${feature.target}" not found`);
        for (const toolId of feature.tools) {
          const tool = bodies.get(toolId);
          if (!tool) throw new Error(`Tool body "${toolId}" not found`);
          target.geometry = runCsg(target.geometry, tool.geometry, feature.op);
          bodies.delete(toolId);
        }
        break;
      }

      case "transform": {
        const body = bodies.get(feature.body);
        if (!body) throw new Error(`Body "${feature.body}" not found`);
        const m = new THREE.Matrix4();
        if (feature.rotate) {
          const [rx, ry, rz] = feature.rotate.map(n);
          m.makeRotationFromEuler(
            new THREE.Euler((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180, "XYZ"),
          );
        }
        if (feature.scale !== undefined) {
          const s = n(feature.scale);
          if (s <= 0) throw new Error("Scale must be > 0");
          m.multiply(new THREE.Matrix4().makeScale(s, s, s));
        }
        if (feature.translate) {
          const [x, y, z] = feature.translate.map(n);
          m.setPosition(x, y, z);
        }
        body.geometry = applyMatrixFixed(body.geometry.clone(), m);
        break;
      }

      case "mirror": {
        const body = bodies.get(feature.body);
        if (!body) throw new Error(`Body "${feature.body}" not found`);
        const off = feature.planeOffset ? n(feature.planeOffset) : 0;
        const m = mirrorMatrix(feature.plane, off);
        const mirrored = applyMatrixFixed(body.geometry.clone(), m);
        if (feature.merge === false) {
          bodies.set(feature.id, {
            id: feature.id,
            name: feature.name ?? `${body.name} (mirror)`,
            geometry: mirrored,
          });
        } else {
          body.geometry = runCsg(body.geometry, mirrored, "join");
        }
        break;
      }

      case "pattern": {
        evaluatePattern(feature);
        break;
      }

      case "loft": {
        evaluateLoft(feature);
        break;
      }

      case "shell": {
        evaluateShell(feature);
        break;
      }
    }
  }

  function evaluateLoft(feature: LoftFeature): void {
    if (feature.sections.length < 2) throw new Error("Loft needs at least 2 sections");
    const sks = feature.sections.map((id) => {
      const sk = sketchFeatures.get(id);
      if (!sk) throw new Error(`Sketch "${id}" not found (must appear earlier in the timeline)`);
      return sk;
    });
    const planeName = sks[0].plane.plane;
    if (sks.some((sk) => sk.plane.plane !== planeName)) {
      throw new Error("All loft sections must be sketched on the same plane orientation in this version");
    }
    const sections = sks.map((sk) => {
      const { shapes } = buildProfile(sk, params);
      if (shapes.length !== 1 || shapes[0].holes.length > 0) {
        throw new Error(`Loft section "${sk.id}" must have exactly one hole-free profile`);
      }
      return { shape: shapes[0], height: sk.plane.offset ? n(sk.plane.offset) : 0 };
    });
    const geom = buildLoftedSolid(sections);
    applyMatrixFixed(geom, planeMatrix(planeName, 0));
    ensureOutward(geom);
    integrate(feature, geom, "Loft");
  }

  function evaluateShell(feature: ShellFeature): void {
    const targetFeature = doc.features.find((f) => f.id === feature.target);
    if (!targetFeature || targetFeature.type !== "extrude") {
      throw new Error(`Shell target "${feature.target}" must be an earlier extrude feature`);
    }
    if ((targetFeature.direction ?? 1) !== 1) {
      throw new Error("Shell only supports the default extrude direction in this version");
    }
    if (targetFeature.draftAngle) {
      throw new Error("Shell does not support a drafted extrude target in this version");
    }
    const body = bodies.get(feature.target);
    if (!body) throw new Error(`Body "${feature.target}" not found`);
    const sk = sketchFeatures.get(targetFeature.sketch);
    if (!sk) throw new Error(`Sketch "${targetFeature.sketch}" not found`);
    if (sk.entities.length !== 1 || sk.entities[0].hole) {
      throw new Error("Shell only supports a single-entity, hole-free profile in this version");
    }
    const wall = n(feature.wall);
    if (wall <= 0) throw new Error("Shell wall thickness must be > 0");
    const dist = n(targetFeature.distance);
    if (wall >= dist) throw new Error("Shell wall thickness must be less than the extrude depth");

    const insetEntity = insetEntityForShell(sk.entities[0], wall, params);
    const { shapes } = buildProfile({ ...sk, entities: [insetEntity] }, params);
    const cavityGeom = new THREE.ExtrudeGeometry(shapes, {
      depth: dist - wall,
      bevelEnabled: false,
      curveSegments: 24,
    });
    cavityGeom.translate(0, 0, wall);
    const planeOffset = sk.plane.offset ? n(sk.plane.offset) : 0;
    applyMatrixFixed(cavityGeom, planeMatrix(sk.plane.plane, planeOffset));
    ensureOutward(cavityGeom);

    body.geometry = runCsg(body.geometry, cavityGeom, "cut");
  }

  function evaluatePattern(feature: PatternFeature): void {
    const body = bodies.get(feature.body);
    if (!body) throw new Error(`Body "${feature.body}" not found`);
    const count = Math.round(n(feature.count));
    if (count < 2) throw new Error("Pattern count must be >= 2");
    if (count > 64) throw new Error("Pattern count is limited to 64");

    const instances: THREE.BufferGeometry[] = [];
    for (let i = 1; i < count; i++) {
      const m = new THREE.Matrix4();
      if (feature.kind === "linear") {
        if (!feature.spacing) throw new Error("Linear pattern needs a spacing vector");
        const [sx, sy, sz] = feature.spacing.map(n);
        m.makeTranslation(sx * i, sy * i, sz * i);
      } else {
        const total = feature.totalAngle === undefined ? 360 : n(feature.totalAngle);
        const isFull = Math.abs((Math.abs(total) % 360) - 0) < 1e-9;
        const step = ((isFull ? total / count : total / (count - 1)) * i * Math.PI) / 180;
        const axis =
          feature.axis === "x"
            ? new THREE.Vector3(1, 0, 0)
            : feature.axis === "y"
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
        m.makeRotationAxis(axis, step);
      }
      instances.push(applyMatrixFixed(body.geometry.clone(), m));
    }

    if (feature.merge === false) {
      instances.forEach((geom, i) => {
        const id = `${feature.id}_${i + 1}`;
        bodies.set(id, { id, name: `${body.name} (${i + 2})`, geometry: geom });
      });
    } else {
      let acc = body.geometry;
      for (const inst of instances) acc = runCsg(acc, inst, "join");
      body.geometry = acc;
    }
  }

  return {
    bodies: [...bodies.values()].map((b) => ({ id: b.id, name: b.name, geometry: b.geometry })),
    sketches: sketchOutlines,
    errors,
    params,
  };
}

/** Revolve a closed 2D contour (sketch u,v points) around a sketch-space axis line. */
function latheFromContour(
  contour: THREE.Vector2[],
  axis: "x" | "y",
  axisOffset: number,
): THREE.BufferGeometry {
  // Map contour into lathe space: x = radius from axis, y = position along axis.
  const pts = contour.map((p) => {
    const radius = axis === "y" ? p.x - axisOffset : p.y - axisOffset;
    const height = axis === "y" ? p.y : p.x;
    return new THREE.Vector2(radius, height);
  });
  for (const p of pts) {
    if (p.x < -1e-6) {
      throw new Error("Revolve profile crosses its axis; keep the profile on one side of the axis");
    }
    if (p.x < 0) p.x = 0;
  }
  // Close the loop for a watertight solid.
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) > 1e-9) {
    pts.push(pts[0].clone());
  }
  const lathe = new THREE.LatheGeometry(pts, 64);
  // Place the lathe (axis = its Y) back into sketch-local 3D space.
  const m = new THREE.Matrix4();
  if (axis === "y") {
    // lathe X→u (+offset), lathe Y→v, lathe Z→w. Right-handed identity.
    m.makeTranslation(axisOffset, 0, 0);
  } else {
    // lathe X→v (+offset), lathe Y→u, lathe Z→−w (right-handed).
    m.set(0, 1, 0, 0, 1, 0, 0, axisOffset, 0, 0, -1, 0, 0, 0, 0, 1);
  }
  applyMatrixFixed(lathe, m);
  const geom = lathe.toNonIndexed();
  ensureOutward(geom);
  geom.computeVertexNormals();
  return geom;
}

/** Resample a closed polyline to exactly `count` points, evenly spaced by arc
 *  length, so profiles of differing original complexity (e.g. a rounded rect
 *  vs. a plain circle) can be ribboned together point-for-point in a loft. */
function resampleClosedPolyline(pts: THREE.Vector2[], count: number): THREE.Vector2[] {
  const n = pts.length;
  const segLen = (i: number) => pts[(i + 1) % n].distanceTo(pts[i]);
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    cum.push(total);
    total += segLen(i);
  }
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    let i = 0;
    while (i < n - 1 && cum[i + 1] <= target) i++;
    const len = segLen(i) || 1e-9;
    const t = (target - cum[i]) / len;
    const a = pts[i],
      b = pts[(i + 1) % n];
    out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
  return out;
}

const LOFT_RING_SAMPLES = 80;

/**
 * Loft a solid connecting 2+ closed profiles (no holes) at given heights
 * along a shared local Z axis. Side walls ribbon corresponding resampled
 * boundary points between consecutive sections; only the first and last
 * sections get end caps (triangulated from their original, unresampled
 * shape for accuracy). Winding is analytically outward-facing by
 * construction (verified: CCW profile boundary + increasing height → outward
 * side-wall normals; bottom cap wound reversed, top cap natural).
 */
function buildLoftedSolid(sections: { shape: THREE.Shape; height: number }[]): THREE.BufferGeometry {
  if (sections.length < 2) throw new Error("Loft needs at least 2 sections");
  const rings = sections.map((s) => ({
    pts: resampleClosedPolyline(s.shape.getPoints(64), LOFT_RING_SAMPLES),
    height: s.height,
  }));

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i],
      r1 = rings[i + 1];
    for (let k = 0; k < LOFT_RING_SAMPLES; k++) {
      const k1 = (k + 1) % LOFT_RING_SAMPLES;
      const a = new THREE.Vector3(r0.pts[k].x, r0.pts[k].y, r0.height);
      const b = new THREE.Vector3(r0.pts[k1].x, r0.pts[k1].y, r0.height);
      const c = new THREE.Vector3(r1.pts[k1].x, r1.pts[k1].y, r1.height);
      const d = new THREE.Vector3(r1.pts[k].x, r1.pts[k].y, r1.height);
      pushTri(a, b, c);
      pushTri(a, c, d);
    }
  }

  const capTriangles = (shape: THREE.Shape, height: number, flip: boolean) => {
    const pts2 = shape.getPoints(64);
    const tris = ShapeUtils.triangulateShape(pts2, []);
    for (const [i0, i1, i2] of tris) {
      const p0 = pts2[i0],
        p1 = pts2[i1],
        p2 = pts2[i2];
      const a = new THREE.Vector3(p0.x, p0.y, height);
      const b = new THREE.Vector3(p1.x, p1.y, height);
      const c = new THREE.Vector3(p2.x, p2.y, height);
      if (flip) pushTri(a, c, b);
      else pushTri(a, b, c);
    }
  };
  capTriangles(sections[0].shape, sections[0].height, true);
  capTriangles(sections[sections.length - 1].shape, sections[sections.length - 1].height, false);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/** Scale a shape's boundary about its own centroid — used to approximate a
 *  draft/taper profile. Exact for circular/regular profiles; an approximation
 *  (uniform scale rather than true per-edge offset) for irregular ones. */
function scaleShapeAboutCentroid(shape: THREE.Shape, factor: number): THREE.Shape {
  const pts = shape.getPoints(64);
  const centroid = new THREE.Vector2();
  for (const p of pts) centroid.add(p);
  centroid.divideScalar(pts.length);
  return new THREE.Shape(pts.map((p) => centroid.clone().add(p.clone().sub(centroid).multiplyScalar(factor))));
}

/** Only rect/circle/ngon entities can be inset for the shell feature (v1). */
function insetEntityForShell(e: SketchEntity, wall: number, params: Record<string, number>): SketchEntity {
  const val = (x: Expr) => evalExpr(x, params);
  switch (e.kind) {
    case "rect": {
      const w = val(e.width) - 2 * wall;
      const h = val(e.height) - 2 * wall;
      if (w <= 0 || h <= 0) throw new Error(`Shell wall too thick for profile "${e.id}"`);
      const r = e.cornerRadius ? Math.max(val(e.cornerRadius) - wall, 0) : undefined;
      return { ...e, width: w, height: h, cornerRadius: r };
    }
    case "circle": {
      const r = val(e.radius) - wall;
      if (r <= 0) throw new Error(`Shell wall too thick for profile "${e.id}"`);
      return { ...e, radius: r };
    }
    case "ngon": {
      const r = val(e.radius) - wall;
      if (r <= 0) throw new Error(`Shell wall too thick for profile "${e.id}"`);
      return { ...e, radius: r };
    }
    default:
      throw new Error(
        `Shell only supports rect/circle/ngon profiles in this version (entity "${e.id}" is "${e.kind}")`,
      );
  }
}

function mirrorMatrix(plane: PlaneName, offset: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  switch (plane) {
    case "XY":
      m.makeScale(1, 1, -1);
      m.setPosition(0, 0, 2 * offset);
      break;
    case "XZ":
      m.makeScale(1, -1, 1);
      m.setPosition(0, 2 * offset, 0);
      break;
    case "YZ":
      m.makeScale(-1, 1, 1);
      m.setPosition(2 * offset, 0, 0);
      break;
  }
  return m;
}
