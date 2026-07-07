/** Binary STL export for evaluated bodies. */

import * as THREE from "three";
import type { EvaluatedBody } from "./evaluate";

export function exportSTL(bodies: EvaluatedBody[], name: string): ArrayBuffer {
  let triCount = 0;
  for (const body of bodies) {
    const idx = body.geometry.getIndex();
    triCount += (idx ? idx.count : body.geometry.getAttribute("position").count) / 3;
  }

  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = `SolidPilot STL: ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);

  let offset = 84;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    nrm = new THREE.Vector3();

  for (const body of bodies) {
    const pos = body.geometry.getAttribute("position");
    const idx = body.geometry.getIndex();
    const n = (idx ? idx.count : pos.count) / 3;
    for (let i = 0; i < n; i++) {
      const i0 = idx ? idx.getX(i * 3) : i * 3;
      const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      nrm.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();

      view.setFloat32(offset, nrm.x, true);
      view.setFloat32(offset + 4, nrm.y, true);
      view.setFloat32(offset + 8, nrm.z, true);
      let o = offset + 12;
      for (const v of [a, b, c]) {
        view.setFloat32(o, v.x, true);
        view.setFloat32(o + 4, v.y, true);
        view.setFloat32(o + 8, v.z, true);
        o += 12;
      }
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }
  return buffer;
}
