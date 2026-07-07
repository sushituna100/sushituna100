/**
 * Mass properties computed from evaluated triangle meshes:
 * volume (divergence theorem over signed tetrahedra), surface area,
 * axis-aligned bounding box, center of mass, and mass for the document material.
 */

import * as THREE from "three";
import type { EvaluatedBody } from "./evaluate";
import type { Material } from "./types";
import { DEFAULT_MATERIAL } from "./types";

export interface BodyMassProperties {
  bodyId: string;
  bodyName: string;
  /** mm^3 */
  volume: number;
  /** mm^2 */
  surfaceArea: number;
  /** mm, axis aligned */
  boundingBox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
  /** mm */
  centerOfMass: [number, number, number];
  /** grams, using the given material density */
  mass: number;
  material: Material;
  triangles: number;
}

export function measureBody(body: EvaluatedBody, material: Material = DEFAULT_MATERIAL): BodyMassProperties {
  const geom = body.geometry;
  const pos = geom.getAttribute("position");
  const idx = geom.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const cross = new THREE.Vector3();

  let volume = 0;
  let area = 0;
  const com = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i0 = idx ? idx.getX(i * 3) : i * 3;
    const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);

    // Signed tetra volume against origin; centroid weighting for center of mass.
    const v = a.dot(cross.crossVectors(b, c)) / 6;
    volume += v;
    com.addScaledVector(new THREE.Vector3().add(a).add(b).add(c), v / 4); // tetra centroid = (a+b+c+0)/4

    area += cross.crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2;
  }

  if (Math.abs(volume) > 1e-9) com.divideScalar(volume);

  geom.computeBoundingBox();
  const bb = geom.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  bb.getSize(size);

  const volumeAbs = Math.abs(volume);
  return {
    bodyId: body.id,
    bodyName: body.name,
    volume: volumeAbs,
    surfaceArea: area,
    boundingBox: {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
      size: [size.x, size.y, size.z],
    },
    centerOfMass: [com.x, com.y, com.z],
    // volume mm^3 → cm^3 is /1000; density g/cm^3 → grams
    mass: (volumeAbs / 1000) * material.density,
    material,
    triangles: triCount,
  };
}

export function formatMassProperties(p: BodyMassProperties): string {
  const f = (v: number, d = 2) => v.toFixed(d);
  return [
    `Body "${p.bodyName}" (${p.bodyId})`,
    `  volume: ${f(p.volume / 1000, 3)} cm^3`,
    `  mass: ${f(p.mass, 2)} g (${p.material.name}, ${p.material.density} g/cm^3)`,
    `  surface area: ${f(p.surfaceArea / 100, 2)} cm^2`,
    `  bounding box: ${p.boundingBox.size.map((v) => f(v, 2)).join(" x ")} mm`,
    `  center of mass: [${p.centerOfMass.map((v) => f(v, 2)).join(", ")}] mm`,
  ].join("\n");
}
