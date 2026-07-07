/**
 * The document-schema guide injected into the copilot's system prompt.
 * This is the "language" the AI uses to author and edit parts.
 */

export const SCHEMA_GUIDE = `
# SolidPilot CAD document schema (JSON)

A part is a parametric feature timeline. Units: millimeters. Angles: degrees.
Every numeric field ("Expr") accepts a number OR an expression string referencing
parameters, e.g. "base_w / 2 - hole_inset". Functions: sin/cos/tan (degrees),
sqrt, abs, min, max, floor, ceil, round. Constant: pi.

Top level:
{
  "version": 1,
  "name": "bracket",
  "units": "mm",
  "description": "what this part is / requirements it must hit",
  "material": { "name": "Aluminum 6061", "density": 2.7 },   // density g/cm^3
  "parameters": [ { "name": "base_w", "expr": 80, "comment": "overall width" } ],
  "features": [ ...ordered timeline, evaluated top to bottom... ]
}

## Coordinate system
Z is up. Sketch planes: "XY" (ground, normal +Z), "XZ" (vertical, normal -Y),
"YZ" (vertical, normal +X). A sketch plane may have an "offset" along its normal.
Sketch coordinates (u,v) map: XY→(x,y), XZ→(x,z), YZ→(y,z).

## Features

1. sketch — 2D profile on a plane. Entities with "hole": true are subtracted.
{ "id": "sk1", "type": "sketch", "name": "Base profile",
  "plane": { "plane": "XY", "offset": 0 },
  "entities": [
    { "id": "e1", "kind": "rect", "cx": 0, "cy": 0, "width": "base_w", "height": "base_d", "cornerRadius": 5 },
    { "id": "e2", "kind": "circle", "cx": "base_w/2 - 8", "cy": 0, "radius": 3.1, "hole": true },
    { "id": "e3", "kind": "slot", "x1": -10, "y1": 0, "x2": 10, "y2": 0, "width": 6, "hole": true },
    { "id": "e4", "kind": "ngon", "cx": 0, "cy": 20, "radius": 8, "sides": 6 },
    { "id": "e5", "kind": "polygon", "points": [[0,0],[20,0],[10,15]] }
  ] }

2. extrude — profile -> solid. op: "new" creates a body (body id = feature id);
"join"/"cut"/"intersect" combine with "target" body (defaults to first body).
direction: 1 (along plane normal, default), -1, or "symmetric".
{ "id": "ex1", "type": "extrude", "sketch": "sk1", "distance": "base_t", "op": "new" }

3. revolve — revolve profile around an axis IN SKETCH COORDINATES.
axis "y" = vertical line u=axisOffset; axis "x" = horizontal line v=axisOffset.
Only full 360 revolves supported. Profile must stay on one side of the axis.
{ "id": "rv1", "type": "revolve", "sketch": "sk2", "axis": "y", "axisOffset": 0, "op": "new" }

4. primitive — quick solids, centered at "at" (default origin). Cylinder axis = Z.
size: box [w,d,h]; cylinder [radius,height]; sphere [radius]; torus [radius,tube].
{ "id": "p1", "type": "primitive", "kind": "cylinder", "size": [10, 40], "at": [0,0,20], "op": "cut", "target": "ex1" }

5. combine — boolean between existing bodies. Tools are consumed.
{ "id": "c1", "type": "combine", "op": "cut", "target": "ex1", "tools": ["p1"] }

6. transform — move/rotate/scale a body (rotate: Euler XYZ degrees).
{ "id": "t1", "type": "transform", "body": "ex1", "translate": [0,0,10], "rotate": [0,0,45] }

7. mirror — mirror a body across XY/XZ/YZ (+ planeOffset). merge=true (default) unions
the copy into the source; merge=false makes a new body (id = feature id).
{ "id": "m1", "type": "mirror", "body": "ex1", "plane": "YZ" }

8. pattern — linear (spacing vector) or circular (axis x|y|z + totalAngle, default 360).
merge=true (default) unions instances into the source body.
{ "id": "pat1", "type": "pattern", "kind": "circular", "body": "p1", "count": 6, "axis": "z" }

## Rules and best practice
- Feature ids must be unique, short, stable. NEVER change ids of existing features
  when editing — other features reference them.
- A sketch must appear in the timeline BEFORE the feature that uses it.
- Drive key dimensions with named parameters so designs stay editable; when the user
  asks to hit a target (mass, size, clearance), adjust parameters rather than
  rebuilding geometry when possible.
- op "cut"/"join"/"intersect" need an existing target body earlier in the timeline.
- Bodies are referenced by the id of the feature that created them ("op": "new").
- Keep sketches simple: prefer rect/circle/slot/ngon over big polygons.
- "suppressed": true on any feature skips it during evaluation.
`;
