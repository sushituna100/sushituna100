/**
 * Phase 1+2 proof-of-concept: evaluate test documents through BOTH the
 * existing mesh-CSG kernel and the new OCCT evaluator, and compare volumes.
 * Close agreement is strong evidence the OCCT integration is correct.
 * See CLAUDE.md "B-rep migration".
 */
import fs from "node:fs";
import * as THREE from "three";
import { evaluateDocument } from "../src/kernel/evaluate";
import type { CadDocument } from "../src/kernel/types";
import { evaluateDocumentOcct } from "../server/occt/evaluate";

const rectBox: CadDocument = {
  version: 1,
  name: "test-rect-box",
  units: "mm",
  parameters: [],
  features: [
    {
      id: "sk1",
      type: "sketch",
      plane: { plane: "XY", offset: 0 },
      entities: [{ id: "e1", kind: "rect", cx: 5, cy: -3, width: 80, height: 50, cornerRadius: 6 }],
    },
    { id: "ex1", type: "extrude", sketch: "sk1", distance: 6, op: "new" },
  ],
};

const cylinder: CadDocument = {
  version: 1,
  name: "test-cylinder",
  units: "mm",
  parameters: [{ name: "r", expr: 15 }, { name: "h", expr: 40 }],
  features: [
    {
      id: "sk1",
      type: "sketch",
      plane: { plane: "XZ", offset: 10 },
      entities: [{ id: "e1", kind: "circle", cx: 0, cy: 0, radius: "r" }],
    },
    { id: "ex1", type: "extrude", sketch: "sk1", distance: "h", op: "new" },
  ],
};

const mountingBracket: CadDocument = JSON.parse(
  fs.readFileSync("projects/demo/mounting-bracket.cad.json", "utf8"),
);

let allPass = true;

for (const doc of [rectBox, cylinder, mountingBracket]) {
  console.log(`\n=== ${doc.name} ===`);
  const mesh = evaluateDocument(doc);
  const occt = await evaluateDocumentOcct(doc);

  if (mesh.errors.length) console.log("mesh-CSG errors:", mesh.errors);
  if (occt.errors.length) console.log("OCCT errors:", occt.errors);

  const meshBody = mesh.bodies.find((b) => b.id === (doc.name === "mounting-bracket" ? "ex_base" : "ex1")) ?? mesh.bodies[0];
  const occtBody = occt.bodies.find((b) => b.id === meshBody?.id) ?? occt.bodies[0];

  const meshVol = meshBody ? computeMeshVolume(meshBody.geometry) : NaN;
  const occtVol = occtBody?.volume ?? NaN;
  const pctDiff = (Math.abs(meshVol - occtVol) / meshVol) * 100;

  console.log(`mesh-CSG volume: ${meshVol.toFixed(4)} mm^3`);
  console.log(`OCCT volume:     ${occtVol.toFixed(4)} mm^3`);
  console.log(`difference:      ${pctDiff.toFixed(4)}%`);
  console.log(`OCCT triangles:  ${occtBody?.triangles.length ? occtBody.triangles.length / 3 : 0}`);

  if (!(pctDiff < 0.5)) {
    allPass = false;
    console.log("FAIL: volumes disagree by more than 0.5%");
  } else {
    console.log("PASS");
  }
}

process.exit(allPass ? 0 : 1);

function computeMeshVolume(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute("position");
  const idx = geom.getIndex();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let vol = 0;
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
  return Math.abs(vol);
}
