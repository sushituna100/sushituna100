/**
 * SolidPilot document model.
 *
 * A CAD document is a fully parametric, serializable JSON description of a part:
 * named parameters (expressions) plus an ordered feature timeline. The evaluator
 * replays the timeline to produce solid bodies. Because the entire model is plain
 * JSON, the AI copilot can read, diff, and rewrite designs the same way Cursor
 * edits source code.
 *
 * Units are millimeters, angles are degrees.
 */

/** Any numeric input in the document: a number or an expression string like "base_w / 2 + 4". */
export type Expr = number | string;

export interface Parameter {
  name: string;
  expr: Expr;
  comment?: string;
}

export type PlaneName = "XY" | "XZ" | "YZ";

export interface SketchPlane {
  plane: PlaneName;
  /** Offset along the plane normal, in mm. */
  offset?: Expr;
}

/* ------------------------------ Sketch entities ------------------------------ */

interface SketchEntityBase {
  id: string;
  /** When true this entity is subtracted from the profile (a hole). */
  hole?: boolean;
}

export interface RectEntity extends SketchEntityBase {
  kind: "rect";
  /** Center position in sketch coordinates. */
  cx: Expr;
  cy: Expr;
  width: Expr;
  height: Expr;
  /** Optional corner fillet radius. */
  cornerRadius?: Expr;
}

export interface CircleEntity extends SketchEntityBase {
  kind: "circle";
  cx: Expr;
  cy: Expr;
  radius: Expr;
}

export interface PolygonEntity extends SketchEntityBase {
  kind: "polygon";
  /** Closed polygon; points in sketch coordinates. */
  points: [Expr, Expr][];
}

/** Rounded slot between two centers. */
export interface SlotEntity extends SketchEntityBase {
  kind: "slot";
  x1: Expr;
  y1: Expr;
  x2: Expr;
  y2: Expr;
  width: Expr;
}

/** Regular N-sided polygon (hexagon for bolt heads, etc.). */
export interface NgonEntity extends SketchEntityBase {
  kind: "ngon";
  cx: Expr;
  cy: Expr;
  /** Circumscribed radius (center to vertex). */
  radius: Expr;
  sides: Expr;
  /** Rotation of the first vertex, degrees. */
  rotation?: Expr;
}

export type SketchEntity = RectEntity | CircleEntity | PolygonEntity | SlotEntity | NgonEntity;

/* --------------------------------- Features --------------------------------- */

export type BooleanOp = "new" | "join" | "cut" | "intersect";

interface FeatureBase {
  id: string;
  name?: string;
  /** Suppressed features are skipped during evaluation. */
  suppressed?: boolean;
}

export interface SketchFeature extends FeatureBase {
  type: "sketch";
  plane: SketchPlane;
  entities: SketchEntity[];
}

export interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  /** id of the sketch feature providing the profile. */
  sketch: string;
  distance: Expr;
  /** 1 = along plane normal, -1 = opposite, "symmetric" = both ways, half each side. */
  direction?: 1 | -1 | "symmetric";
  op: BooleanOp;
  /** Body id to combine with for join/cut/intersect. Defaults to the first body. */
  target?: string;
}

export interface RevolveFeature extends FeatureBase {
  type: "revolve";
  sketch: string;
  /** Axis in sketch coordinates: "x" (horizontal) or "y" (vertical) through axisOffset. */
  axis: "x" | "y";
  axisOffset?: Expr;
  /** Only full revolutions are supported in v0 (angle must evaluate to 360). */
  angle?: Expr;
  op: BooleanOp;
  target?: string;
}

export interface PrimitiveFeature extends FeatureBase {
  type: "primitive";
  kind: "box" | "cylinder" | "sphere" | "torus";
  /** box: [w,d,h]; cylinder: [radius,height]; sphere: [radius]; torus: [radius,tube]. */
  size: Expr[];
  /** Center position. Boxes/cylinders sit centered; cylinder axis = Z. */
  at?: [Expr, Expr, Expr];
  rotate?: [Expr, Expr, Expr];
  op: BooleanOp;
  target?: string;
}

export interface CombineFeature extends FeatureBase {
  type: "combine";
  op: "join" | "cut" | "intersect";
  /** Body kept as the result. */
  target: string;
  /** Bodies consumed by the operation. */
  tools: string[];
}

export interface TransformFeature extends FeatureBase {
  type: "transform";
  body: string;
  translate?: [Expr, Expr, Expr];
  /** Euler XYZ, degrees. */
  rotate?: [Expr, Expr, Expr];
  scale?: Expr;
}

export interface MirrorFeature extends FeatureBase {
  type: "mirror";
  body: string;
  plane: PlaneName;
  planeOffset?: Expr;
  /** Join the mirrored copy into the source body. */
  merge?: boolean;
}

export interface PatternFeature extends FeatureBase {
  type: "pattern";
  kind: "linear" | "circular";
  body: string;
  count: Expr;
  /** linear: spacing vector between instances. */
  spacing?: [Expr, Expr, Expr];
  /** circular: rotation axis and total angle (degrees) spanned by the pattern. */
  axis?: "x" | "y" | "z";
  totalAngle?: Expr;
  /** Union all instances into the source body (default true). */
  merge?: boolean;
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | PrimitiveFeature
  | CombineFeature
  | TransformFeature
  | MirrorFeature
  | PatternFeature;

export type FeatureType = Feature["type"];

/* --------------------------------- Document --------------------------------- */

export interface Material {
  name: string;
  /** g/cm^3 */
  density: number;
}

export interface CadDocument {
  version: 1;
  name: string;
  units: "mm";
  description?: string;
  material?: Material;
  parameters: Parameter[];
  features: Feature[];
}

export const DEFAULT_MATERIAL: Material = { name: "Aluminum 6061", density: 2.7 };

export function emptyDocument(name: string): CadDocument {
  return {
    version: 1,
    name,
    units: "mm",
    description: "",
    material: DEFAULT_MATERIAL,
    parameters: [],
    features: [],
  };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 46656;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
