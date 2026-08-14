/**
 * EXPERIMENTAL — Phase 1 spike for the OpenCascade/B-rep evaluator migration
 * (see CLAUDE.md "B-rep migration"). Server-side only, not wired into the
 * app. Handles a deliberately small subset of the document schema (a single
 * rect/circle sketch entity + one extrude) to prove the fundamentals: WASM
 * init, sketch, extrude, tessellation, and volume all work correctly in this
 * Node environment — cross-checked against the existing mesh-CSG kernel.
 */
import { drawCircle, drawRoundedRectangle, measureVolume } from "replicad";
import { evalExpr, resolveParameters } from "../../src/kernel/expr";
import type { CadDocument, Expr, SketchFeature } from "../../src/kernel/types";
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

export async function evaluateDocumentOcct(doc: CadDocument): Promise<OcctEvaluation> {
  await initOcct();
  const params = resolveParameters(doc.parameters);
  const n = (x: Expr) => evalExpr(x, params);

  const sketches = new Map<string, SketchFeature>();
  const bodies: OcctBody[] = [];
  const errors: { featureId: string; message: string }[] = [];

  for (const f of doc.features) {
    if (f.suppressed) continue;
    try {
      if (f.type === "sketch") {
        sketches.set(f.id, f);
      } else if (f.type === "extrude") {
        const sk = sketches.get(f.sketch);
        if (!sk) throw new Error(`Sketch "${f.sketch}" not found`);
        if (f.op !== "new") throw new Error("OCCT spike only supports op=new");
        if (sk.entities.length !== 1) throw new Error("OCCT spike only supports single-entity sketches");
        const e = sk.entities[0];

        let drawing;
        if (e.kind === "rect") {
          drawing = drawRoundedRectangle(n(e.width), n(e.height), e.cornerRadius ? n(e.cornerRadius) : 0).translate(
            n(e.cx),
            n(e.cy),
          );
        } else if (e.kind === "circle") {
          drawing = drawCircle(n(e.radius)).translate(n(e.cx), n(e.cy));
        } else {
          throw new Error(`OCCT spike does not yet support entity kind "${e.kind}"`);
        }

        const offset = sk.plane.offset ? n(sk.plane.offset) : 0;
        const sketch = drawing.sketchOnPlane(sk.plane.plane, offset);
        const solid = sketch.extrude(n(f.distance));
        // A rect/circle profile extrude always yields a genuine 3D solid ("fuse" only
        // exists on _3DShape, not on the lower-dimensional Vertex/Edge/Wire/Face members
        // of the AnyShape union) — this check makes that assumption explicit and safe.
        if (!("fuse" in solid)) throw new Error("Extrude did not produce a solid (unexpected for a closed profile)");
        const mesh = solid.mesh();
        bodies.push({
          id: f.id,
          name: f.name ?? "Extrude",
          volume: measureVolume(solid),
          vertices: mesh.vertices,
          triangles: mesh.triangles,
        });
      }
    } catch (err) {
      errors.push({ featureId: f.id, message: String((err as Error).message ?? err) });
    }
  }

  return { bodies, errors };
}
