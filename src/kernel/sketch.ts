/**
 * Sketch profile builder: converts sketch entities into THREE.Shape profiles
 * (outer boundaries + holes) ready for extrusion/revolution, and provides the
 * plane transform that places sketch (u,v) coordinates into 3D space.
 */

import * as THREE from "three";
import { evalExpr } from "./expr";
import type { PlaneName, SketchEntity, SketchFeature } from "./types";

export interface BuiltProfile {
  shapes: THREE.Shape[];
}

type Params = Record<string, number>;

/** 2D outline for one entity as a THREE.Path (closed). */
function entityPath(e: SketchEntity, params: Params): THREE.Path {
  const n = (x: number | string) => evalExpr(x, params);
  switch (e.kind) {
    case "rect": {
      const cx = n(e.cx),
        cy = n(e.cy),
        w = n(e.width),
        h = n(e.height);
      if (w <= 0 || h <= 0) throw new Error(`Rect ${e.id}: width/height must be > 0`);
      const r = Math.min(e.cornerRadius ? n(e.cornerRadius) : 0, w / 2 - 1e-6, h / 2 - 1e-6);
      const p = new THREE.Path();
      const x0 = cx - w / 2,
        y0 = cy - h / 2,
        x1 = cx + w / 2,
        y1 = cy + h / 2;
      if (r <= 1e-9) {
        p.moveTo(x0, y0);
        p.lineTo(x1, y0);
        p.lineTo(x1, y1);
        p.lineTo(x0, y1);
        p.closePath();
      } else {
        p.moveTo(x0 + r, y0);
        p.lineTo(x1 - r, y0);
        p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
        p.lineTo(x1, y1 - r);
        p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
        p.lineTo(x0 + r, y1);
        p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
        p.lineTo(x0, y0 + r);
        p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
        p.closePath();
      }
      return p;
    }
    case "circle": {
      const r = n(e.radius);
      if (r <= 0) throw new Error(`Circle ${e.id}: radius must be > 0`);
      const p = new THREE.Path();
      p.absarc(n(e.cx), n(e.cy), r, 0, Math.PI * 2, false);
      p.closePath();
      return p;
    }
    case "ngon": {
      const r = n(e.radius);
      const sides = Math.max(3, Math.round(n(e.sides)));
      if (r <= 0) throw new Error(`Ngon ${e.id}: radius must be > 0`);
      const rot = ((e.rotation ? n(e.rotation) : 0) * Math.PI) / 180;
      const cx = n(e.cx),
        cy = n(e.cy);
      const p = new THREE.Path();
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    }
    case "polygon": {
      if (e.points.length < 3) throw new Error(`Polygon ${e.id}: needs at least 3 points`);
      const p = new THREE.Path();
      e.points.forEach(([x, y], i) => {
        if (i === 0) p.moveTo(n(x), n(y));
        else p.lineTo(n(x), n(y));
      });
      p.closePath();
      return p;
    }
    case "slot": {
      const x1 = n(e.x1),
        y1 = n(e.y1),
        x2 = n(e.x2),
        y2 = n(e.y2),
        w = n(e.width);
      if (w <= 0) throw new Error(`Slot ${e.id}: width must be > 0`);
      const r = w / 2;
      const dx = x2 - x1,
        dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) {
        // degenerate slot = circle
        const p = new THREE.Path();
        p.absarc(x1, y1, r, 0, Math.PI * 2, false);
        p.closePath();
        return p;
      }
      const a = Math.atan2(dy, dx);
      const p = new THREE.Path();
      p.absarc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2, false);
      p.absarc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2, false);
      p.closePath();
      return p;
    }
  }
}

function pathCentroid(p: THREE.Path): THREE.Vector2 {
  const pts = p.getPoints(16);
  const c = new THREE.Vector2();
  for (const pt of pts) c.add(pt);
  return c.divideScalar(Math.max(1, pts.length));
}

function pointInPath(pt: THREE.Vector2, path: THREE.Path): boolean {
  const poly = path.getPoints(48);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Build extrudable shapes from a sketch: solid entities become outer boundaries,
 * hole entities are attached to whichever solid contains them.
 */
export function buildProfile(sketch: SketchFeature, params: Params): BuiltProfile {
  const solids: { path: THREE.Path; shape: THREE.Shape }[] = [];
  const holes: THREE.Path[] = [];

  for (const e of sketch.entities) {
    const path = entityPath(e, params);
    if (e.hole) {
      holes.push(path);
    } else {
      const shape = new THREE.Shape(path.getPoints(64));
      shape.closePath();
      solids.push({ path, shape });
    }
  }

  if (solids.length === 0) {
    throw new Error(`Sketch "${sketch.name ?? sketch.id}" has no solid profile (only holes?)`);
  }

  for (const h of holes) {
    const c = pathCentroid(h);
    const owner = solids.find((s) => pointInPath(c, s.path)) ?? solids[0];
    const holePath = new THREE.Path(h.getPoints(64));
    holePath.closePath();
    owner.shape.holes.push(holePath);
  }

  return { shapes: solids.map((s) => s.shape) };
}

/**
 * Matrix placing sketch-plane coordinates (u,v,0) into world space.
 * XY: u→X, v→Y, normal +Z.  XZ: u→X, v→Z, normal −Y.  YZ: u→Y, v→Z, normal +X.
 * Bases are right-handed so triangle winding survives the transform.
 */
export function planeMatrix(plane: PlaneName, offset: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  switch (plane) {
    case "XY":
      m.identity();
      m.setPosition(0, 0, offset);
      break;
    case "XZ":
      // u→X, v→Z; normal −Y (right-handed: X × Z = −Y)
      m.set(1, 0, 0, 0, 0, 0, -1, -offset, 0, 1, 0, 0, 0, 0, 0, 1);
      break;
    case "YZ":
      // u→Y, v→Z; normal +X
      m.set(0, 0, 1, offset, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
      break;
  }
  return m;
}

/** Plane normal in world space. */
export function planeNormal(plane: PlaneName): THREE.Vector3 {
  switch (plane) {
    case "XY":
      return new THREE.Vector3(0, 0, 1);
    case "XZ":
      return new THREE.Vector3(0, -1, 0);
    case "YZ":
      return new THREE.Vector3(1, 0, 0);
  }
}
