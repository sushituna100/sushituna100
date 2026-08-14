/**
 * EXPERIMENTAL — Phase 2 of the OpenCascade/B-rep evaluator migration (see
 * CLAUDE.md "B-rep migration"). Server-side only, not wired into the app.
 *
 * Phase 1 proved the fundamentals (WASM init, sketch, extrude, tessellation,
 * volume) on a single rect/circle profile. Phase 2 adds: multi-entity
 * sketches with holes, extrude combined with an existing body (join/cut/
 * intersect), the standalone "combine" feature, and box/cylinder primitives
 * (built the same way our own mesh kernel's UI conceptually does — as a
 * sketch + extrude — since this replicad build has no makeBox/makeCylinder
 * shortcuts despite the docs mentioning them; another docs/runtime mismatch
 * like the missing `.volume` getter found in Phase 1).
 */
import { drawCircle, drawRoundedRectangle, measureVolume, type AnyShape, type Drawing, type Shape3D } from "replicad";
import { evalExpr, resolveParameters } from "../../src/kernel/expr";
import type { CadDocument, Expr, Feature, PrimitiveFeature, SketchEntity, SketchFeature } from "../../src/kernel/types";
import { initOcct } from "./init";

export interface OcctBody {
  id: string;
  name: string;
  /** mm^3, straight from OpenCascade — a real B-rep volume, not a mesh approximation. */
  volume: number;
  vertices: number[];
  triangles: number[];
}

export interface OcctEvaluation {
  bodies: OcctBody[];
  errors: { featureId: string; message: string }[];
}

/** Runtime-checked narrowing to Shape3D: "fuse" only exists on the 3D branch of
 *  AnyShape (Vertex/Edge/Wire/Face don't have it) — checked at runtime, then
 *  cast, since TS can't narrow a manually-intersected union this way. */
type Solid3D = Shape3D;

function as3D(shape: AnyShape, context: string): Solid3D {
  if (!("fuse" in shape)) throw new Error(`${context}: did not produce a 3D solid`);
  return shape as Solid3D;
}

function entityToDrawing(e: SketchEntity, n: (x: Expr) => number): Drawing {
  switch (e.kind) {
    case "rect":
      return drawRoundedRectangle(n(e.width), n(e.height), e.cornerRadius ? n(e.cornerRadius) : 0).translate(
        n(e.cx),
        n(e.cy),
      );
    case "circle":
      return drawCircle(n(e.radius)).translate(n(e.cx), n(e.cy));
    default:
      throw new Error(`OCCT spike does not yet support entity kind "${e.kind}"`);
  }
}

/** Build the combined (solids fused, holes cut) 2D drawing for a sketch. */
function buildSketchDrawing(sk: SketchFeature, n: (x: Expr) => number): Drawing {
  const solids = sk.entities.filter((e) => !e.hole).map((e) => entityToDrawing(e, n));
  const holes = sk.entities.filter((e) => e.hole).map((e) => entityToDrawing(e, n));
  if (solids.length === 0) throw new Error("Sketch has no solid profile");
  let drawing = solids[0];
  for (const s of solids.slice(1)) drawing = drawing.fuse(s);
  for (const h of holes) drawing = drawing.cut(h);
  return drawing;
}

function extrudeSketch(sk: SketchFeature, distance: number, n: (x: Expr) => number): Solid3D {
  const drawing = buildSketchDrawing(sk, n);
  const offset = sk.plane.offset ? n(sk.plane.offset) : 0;
  const sketch = drawing.sketchOnPlane(sk.plane.plane, offset);
  const solid = sketch.extrude(distance);
  return as3D(solid, "extrude");
}

/** Apply an XYZ Euler rotation (degrees) as three sequential single-axis
 *  rotations, matching the mesh kernel's THREE.Euler(..., "XYZ") convention. */
function applyEulerRotation(shape: AnyShape, rx: number, ry: number, rz: number): AnyShape {
  let s = shape;
  if (rx) s = s.rotate(rx, [0, 0, 0], [1, 0, 0]);
  if (ry) s = s.rotate(ry, [0, 0, 0], [0, 1, 0]);
  if (rz) s = s.rotate(rz, [0, 0, 0], [0, 0, 1]);
  return s;
}

function buildPrimitive(feature: PrimitiveFeature, n: (x: Expr) => number): Solid3D {
  const s = feature.size.map(n);
  let solid: AnyShape;
  if (feature.kind === "box") {
    if (s.length < 3 || s.some((v) => v <= 0)) throw new Error("Box needs positive [w,d,h]");
    const drawing = drawRoundedRectangle(s[0], s[1], 0);
    solid = drawing.sketchOnPlane("XY", -s[2] / 2).extrude(s[2]);
  } else if (feature.kind === "cylinder") {
    if (s.length < 2 || s.some((v) => v <= 0)) throw new Error("Cylinder needs positive [radius,height]");
    const drawing = drawCircle(s[0]);
    solid = drawing.sketchOnPlane("XY", -s[1] / 2).extrude(s[1]);
  } else {
    throw new Error(`OCCT spike does not yet support primitive kind "${feature.kind}"`);
  }
  if (feature.rotate) {
    const [rx, ry, rz] = feature.rotate.map(n);
    solid = applyEulerRotation(solid, rx, ry, rz);
  }
  if (feature.at) {
    const [x, y, z] = feature.at.map(n);
    solid = solid.translate([x, y, z]);
  }
  return as3D(solid, `primitive "${feature.kind}"`);
}

function combineInto(target: Solid3D, tool: Solid3D, op: "join" | "cut" | "intersect"): Solid3D {
  const result = op === "join" ? target.fuse(tool) : op === "cut" ? target.cut(tool) : target.intersect(tool);
  return as3D(result, `combine (${op})`);
}

export async function evaluateDocumentOcct(doc: CadDocument): Promise<OcctEvaluation> {
  await initOcct();
  const params = resolveParameters(doc.parameters);
  const n = (x: Expr) => evalExpr(x, params);

  const sketches = new Map<string, SketchFeature>();
  const bodies = new Map<string, { id: string; name: string; shape: Solid3D }>();
  const errors: { featureId: string; message: string }[] = [];

  function integrate(feature: Feature & { op: string; target?: string }, shape: Solid3D, defaultName: string) {
    if (feature.op === "new" || bodies.size === 0) {
      bodies.set(feature.id, { id: feature.id, name: ("name" in feature && feature.name) || defaultName, shape });
      return;
    }
    const targetId = feature.target ?? [...bodies.keys()][0];
    const target = bodies.get(targetId);
    if (!target) throw new Error(`Target body "${targetId}" not found`);
    target.shape = combineInto(target.shape, shape, feature.op as "join" | "cut" | "intersect");
  }

  for (const f of doc.features) {
    if (f.suppressed) continue;
    try {
      if (f.type === "sketch") {
        sketches.set(f.id, f);
      } else if (f.type === "extrude") {
        if (f.draftAngle) throw new Error("OCCT spike does not yet support draftAngle");
        const sk = sketches.get(f.sketch);
        if (!sk) throw new Error(`Sketch "${f.sketch}" not found`);
        const shape = extrudeSketch(sk, n(f.distance), n);
        integrate(f, shape, "Extrude");
      } else if (f.type === "primitive") {
        const shape = buildPrimitive(f, n);
        integrate(f, shape, f.kind);
      } else if (f.type === "combine") {
        const target = bodies.get(f.target);
        if (!target) throw new Error(`Target body "${f.target}" not found`);
        for (const toolId of f.tools) {
          const tool = bodies.get(toolId);
          if (!tool) throw new Error(`Tool body "${toolId}" not found`);
          target.shape = combineInto(target.shape, tool.shape, f.op);
          bodies.delete(toolId);
        }
      } else {
        throw new Error(`OCCT spike does not yet support feature type "${f.type}"`);
      }
    } catch (err) {
      errors.push({ featureId: f.id, message: String((err as Error).message ?? err) });
    }
  }

  const result: OcctBody[] = [];
  for (const b of bodies.values()) {
    const mesh = b.shape.mesh();
    result.push({ id: b.id, name: b.name, volume: measureVolume(b.shape), vertices: mesh.vertices, triangles: mesh.triangles });
  }
  return { bodies: result, errors };
}
