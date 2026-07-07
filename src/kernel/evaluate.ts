/**
 * Timeline evaluator: replays a document's feature list and produces solid
 * bodies as triangle meshes. Booleans run through three-bvh-csg (BVH-accelerated
 * mesh CSG). All body geometry is kept baked in world space.
 */

import * as THREE from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import { evalExpr, resolveParameters } from "./expr";
import { buildProfile, planeMatrix, planeNormal } from "./sketch";
import type {
  BooleanOp,
  CadDocument,
  Expr,
  Feature,
  PatternFeature,
  PlaneName,
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
        const geom = new THREE.ExtrudeGeometry(shapes, {
          depth: dist,
          bevelEnabled: false,
          curveSegments: 24,
        });
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
    }
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
