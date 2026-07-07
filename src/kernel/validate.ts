/**
 * Structural validation for CAD documents — used before saving and before
 * accepting AI-proposed edits. Geometry-level problems are caught separately
 * by running the evaluator.
 */

import type { CadDocument, Feature } from "./types";

const FEATURE_TYPES = new Set([
  "sketch",
  "extrude",
  "revolve",
  "primitive",
  "combine",
  "transform",
  "mirror",
  "pattern",
]);

const ENTITY_KINDS = new Set(["rect", "circle", "polygon", "slot", "ngon"]);
const PLANES = new Set(["XY", "XZ", "YZ"]);
const PRIMITIVE_KINDS = new Set(["box", "cylinder", "sphere", "torus"]);

export function validateDocument(doc: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const d = doc as Partial<CadDocument>;

  if (!d || typeof d !== "object") return { ok: false, errors: ["Document is not an object"] };
  if (d.version !== 1) errors.push('version must be 1');
  if (typeof d.name !== "string" || !d.name.trim()) errors.push("name must be a non-empty string");
  if (d.units !== "mm") errors.push('units must be "mm"');
  if (!Array.isArray(d.parameters)) errors.push("parameters must be an array");
  if (!Array.isArray(d.features)) errors.push("features must be an array");
  if (errors.length) return { ok: false, errors };

  const paramNames = new Set<string>();
  for (const p of d.parameters!) {
    if (typeof p?.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) {
      errors.push(`parameter name "${p?.name}" is invalid (use letters, digits, underscore)`);
      continue;
    }
    if (paramNames.has(p.name)) errors.push(`duplicate parameter "${p.name}"`);
    paramNames.add(p.name);
    if (typeof p.expr !== "number" && typeof p.expr !== "string") {
      errors.push(`parameter "${p.name}" expr must be a number or expression string`);
    }
  }

  const featureIds = new Set<string>();
  const sketchIds = new Set<string>();

  for (const [i, f] of (d.features as Feature[]).entries()) {
    const label = `features[${i}]${f?.id ? ` (${f.id})` : ""}`;
    if (!f || typeof f !== "object") {
      errors.push(`${label}: not an object`);
      continue;
    }
    if (typeof f.id !== "string" || !f.id) {
      errors.push(`${label}: missing id`);
      continue;
    }
    if (featureIds.has(f.id)) errors.push(`${label}: duplicate feature id`);
    featureIds.add(f.id);
    if (!FEATURE_TYPES.has(f.type)) {
      errors.push(`${label}: unknown feature type "${(f as { type?: string }).type}"`);
      continue;
    }

    switch (f.type) {
      case "sketch": {
        if (!f.plane || !PLANES.has(f.plane.plane)) errors.push(`${label}: plane.plane must be XY, XZ or YZ`);
        if (!Array.isArray(f.entities) || f.entities.length === 0) {
          errors.push(`${label}: sketch needs at least one entity`);
          break;
        }
        for (const e of f.entities) {
          if (!e?.id) errors.push(`${label}: entity missing id`);
          if (!ENTITY_KINDS.has(e?.kind)) errors.push(`${label}: unknown entity kind "${e?.kind}"`);
          if (e?.kind === "polygon" && (!Array.isArray(e.points) || e.points.length < 3)) {
            errors.push(`${label}: polygon entity needs >= 3 points`);
          }
        }
        if (!f.entities.some((e) => !e.hole)) errors.push(`${label}: sketch has only holes, no solid profile`);
        sketchIds.add(f.id);
        break;
      }
      case "extrude":
      case "revolve": {
        if (!sketchIds.has(f.sketch)) {
          errors.push(`${label}: references sketch "${f.sketch}" which does not appear earlier in the timeline`);
        }
        if (f.type === "revolve" && f.axis !== "x" && f.axis !== "y") {
          errors.push(`${label}: revolve axis must be "x" or "y"`);
        }
        break;
      }
      case "primitive": {
        if (!PRIMITIVE_KINDS.has(f.kind)) errors.push(`${label}: unknown primitive kind "${f.kind}"`);
        if (!Array.isArray(f.size) || f.size.length === 0) errors.push(`${label}: primitive needs a size array`);
        break;
      }
      case "combine": {
        if (typeof f.target !== "string") errors.push(`${label}: combine needs a target body id`);
        if (!Array.isArray(f.tools) || f.tools.length === 0) errors.push(`${label}: combine needs tool body ids`);
        break;
      }
      case "transform":
      case "mirror": {
        if (typeof f.body !== "string") errors.push(`${label}: needs a body id`);
        break;
      }
      case "pattern": {
        if (typeof f.body !== "string") errors.push(`${label}: needs a body id`);
        if (f.kind !== "linear" && f.kind !== "circular") errors.push(`${label}: pattern kind must be linear or circular`);
        if (f.kind === "linear" && !f.spacing) errors.push(`${label}: linear pattern needs spacing [x,y,z]`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
