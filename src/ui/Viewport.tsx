/**
 * 3D viewport: renders evaluated bodies + sketch outlines, handles body
 * selection, view presets, and click-to-draw sketching on the active plane.
 * When an AI proposal is pending, its geometry is previewed in accent color.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { EvaluationResult } from "../kernel/evaluate";
import { planeMatrix } from "../kernel/sketch";
import { newId, type SketchFeature } from "../kernel/types";
import { useStore } from "../state/store";

const BODY_COLOR = 0x9fb4c7;
const BODY_SELECTED = 0xf5a623;
const PROPOSAL_COLOR = 0x62d0a4;
const EDGE_COLOR = 0x1c2126;
/** Clips away the half of the model nearest the default camera position
 *  (which sits at negative Y), revealing interior geometry on demand. */
const SECTION_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function Viewport() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    bodyGroup: THREE.Group;
    sketchGroup: THREE.Group;
    drawGroup: THREE.Group;
    raycaster: THREE.Raycaster;
  } | null>(null);

  const evaluation = useStore((s) => s.evaluation);
  const proposalEvaluation = useStore((s) => s.proposalEvaluation);
  const activeDoc = useStore((s) => s.activeDoc);
  const proposals = useStore((s) => s.proposals);
  const selection = useStore((s) => s.selection);
  const showSketches = useStore((s) => s.showSketches);
  const sectionView = useStore((s) => s.sectionView);
  const sketchMode = useStore((s) => s.sketchMode);

  const hasProposal = activeDoc !== null && Boolean(proposals[activeDoc]);
  const displayed: EvaluationResult | null = hasProposal ? proposalEvaluation : evaluation;

  /* ---------- scene bootstrap ---------- */
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x17191c);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    camera.up.set(0, 0, 1); // Z-up, CAD convention
    camera.position.set(160, -160, 120);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    // Grid on XY (three's GridHelper lies on XZ; rotate into XY).
    const grid = new THREE.GridHelper(400, 40, 0x3a4048, 0x24282d);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const axes = new THREE.AxesHelper(60);
    scene.add(axes);

    scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x30363c, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(200, -150, 300);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xa9c4dd, 0.5);
    dir2.position.set(-180, 120, -80);
    scene.add(dir2);

    const bodyGroup = new THREE.Group();
    const sketchGroup = new THREE.Group();
    const drawGroup = new THREE.Group();
    scene.add(bodyGroup, sketchGroup, drawGroup);

    stateRef.current = {
      scene,
      camera,
      renderer,
      controls,
      bodyGroup,
      sketchGroup,
      drawGroup,
      raycaster: new THREE.Raycaster(),
    };

    const resize = () => {
      const w = mount.clientWidth,
        h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let disposed = false;
    const loop = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    loop();

    return () => {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  /* ---------- sync bodies & sketches ---------- */
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    disposeChildren(st.bodyGroup);
    disposeChildren(st.sketchGroup);

    if (!displayed) return;

    // Section view: clip away the half of the model nearest the default
    // camera position, revealing interior geometry (e.g. a shelled cavity).
    const clipPlanes = sectionView ? [SECTION_PLANE] : [];

    for (const body of displayed.bodies) {
      const color = hasProposal ? PROPOSAL_COLOR : body.id === selection ? BODY_SELECTED : BODY_COLOR;
      const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.15,
        roughness: 0.55,
        transparent: hasProposal,
        opacity: hasProposal ? 0.92 : 1,
        clippingPlanes: clipPlanes,
        side: sectionView ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(body.geometry, mat);
      mesh.userData.bodyId = body.id;
      st.bodyGroup.add(mesh);

      // Mesh CSG leaves tessellation seams that EdgesGeometry can't filter out,
      // so keep the edge overlay subtle. Real silhouette edges come with the
      // B-rep kernel upgrade (see roadmap).
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(body.geometry, 30),
        new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.35, clippingPlanes: clipPlanes }),
      );
      mesh.add(edges);
    }

    if (showSketches) {
      for (const sketch of displayed.sketches) {
        for (const outline of sketch.outlines) {
          const geom = new THREE.BufferGeometry().setFromPoints(outline);
          st.sketchGroup.add(
            new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x5aa9e6 })),
          );
        }
      }
    }
  }, [displayed, selection, showSketches, sectionView, hasProposal]);

  /* ---------- selection + sketch drawing ---------- */
  useEffect(() => {
    const st = stateRef.current;
    const mount = mountRef.current;
    if (!st || !mount) return;

    let drawPts: THREE.Vector3[] = []; // world-space clicked points (sketch draw)
    const store = useStore;

    const ndc = (ev: PointerEvent) => {
      const rect = st.renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const sketchPlaneInfo = () => {
      const s = store.getState();
      if (!s.sketchMode || !s.doc) return null;
      const sk = s.doc.features.find(
        (f) => f.id === s.sketchMode!.sketchId && f.type === "sketch",
      ) as SketchFeature | undefined;
      if (!sk) return null;
      let offset = 0;
      try {
        offset = sk.plane.offset ? Number(sk.plane.offset) || 0 : 0;
      } catch {
        offset = 0;
      }
      const m = planeMatrix(sk.plane.plane, offset);
      const inv = m.clone().invert();
      const normal = new THREE.Vector3(0, 0, 1).applyMatrix4(
        new THREE.Matrix4().extractRotation(m),
      );
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        new THREE.Vector3(0, 0, 0).applyMatrix4(m),
      );
      return { sk, m, inv, plane };
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const s = store.getState();
      const mouse = ndc(ev);
      st.raycaster.setFromCamera(mouse, st.camera);

      // Sketch drawing mode
      if (s.sketchMode?.tool) {
        const info = sketchPlaneInfo();
        if (!info) return;
        const hit = new THREE.Vector3();
        if (!st.raycaster.ray.intersectPlane(info.plane, hit)) return;
        drawPts.push(hit.clone());
        renderDrawPreview(st.drawGroup, drawPts);

        if (drawPts.length === 2) {
          const a = drawPts[0].clone().applyMatrix4(info.inv);
          const b = drawPts[1].clone().applyMatrix4(info.inv);
          const tool = s.sketchMode.tool;
          const sketchId = s.sketchMode.sketchId;
          s.updateDoc((doc) => {
            const sk = doc.features.find((f) => f.id === sketchId) as SketchFeature | undefined;
            if (!sk) return;
            if (tool === "rect") {
              sk.entities.push({
                id: newId("e"),
                kind: "rect",
                cx: round2((a.x + b.x) / 2),
                cy: round2((a.y + b.y) / 2),
                width: Math.max(0.1, round2(Math.abs(b.x - a.x))),
                height: Math.max(0.1, round2(Math.abs(b.y - a.y))),
              });
            } else {
              sk.entities.push({
                id: newId("e"),
                kind: "circle",
                cx: round2(a.x),
                cy: round2(a.y),
                radius: Math.max(0.1, round2(Math.hypot(b.x - a.x, b.y - a.y))),
              });
            }
          });
          drawPts = [];
          disposeChildren(st.drawGroup);
        }
        return;
      }

      // Body selection
      const hits = st.raycaster.intersectObjects(st.bodyGroup.children, false);
      const bodyId = hits.length > 0 ? (hits[0].object.userData.bodyId as string) : null;
      s.setSelection(bodyId);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        drawPts = [];
        disposeChildren(st.drawGroup);
        const s = store.getState();
        if (s.sketchMode?.tool) s.setSketchMode({ ...s.sketchMode, tool: null });
      }
    };

    st.renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      st.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sketchMode]);

  /* ---------- view presets ---------- */
  const setView = (view: "iso" | "top" | "front" | "right" | "fit") => {
    const st = stateRef.current;
    if (!st) return;
    const target = new THREE.Vector3(0, 0, 0);
    let radius = 250;
    if (displayed && displayed.bodies.length > 0) {
      const box = new THREE.Box3();
      for (const b of displayed.bodies) {
        b.geometry.computeBoundingBox();
        if (b.geometry.boundingBox) box.union(b.geometry.boundingBox);
      }
      if (!box.isEmpty()) {
        box.getCenter(target);
        radius = Math.max(60, box.getSize(new THREE.Vector3()).length() * 1.2);
      }
    }
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1, 0.8),
      fit: st.camera.position.clone().sub(st.controls.target).normalize(),
      top: new THREE.Vector3(0, 0, 1),
      front: new THREE.Vector3(0, -1, 0.0001),
      right: new THREE.Vector3(1, 0, 0.0001),
    };
    const dir = dirs[view].clone().normalize();
    st.camera.position.copy(target.clone().addScaledVector(dir, radius));
    st.controls.target.copy(target);
    st.controls.update();
  };

  return (
    <div className="viewport" ref={mountRef}>
      <div className="viewport-toolbar">
        {(["iso", "top", "front", "right", "fit"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} title={`${v} view`}>
            {v.toUpperCase()}
          </button>
        ))}
      </div>
      {sketchMode?.tool && (
        <div className="viewport-hint">
          {sketchMode.tool === "rect"
            ? "Rectangle: click two corners on the sketch plane (Esc to cancel)"
            : "Circle: click center, then a point on the radius (Esc to cancel)"}
        </div>
      )}
    </div>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function renderDrawPreview(group: THREE.Group, pts: THREE.Vector3[]): void {
  disposeChildren(group);
  for (const p of pts) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xf5a623 }),
    );
    dot.position.copy(p);
    group.add(dot);
  }
}

function disposeChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== (child as THREE.Mesh).geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    const asMesh = child as THREE.Mesh;
    // Body geometries belong to the evaluation result; only dispose helper geometry.
    if (asMesh.geometry && !asMesh.userData.bodyId) asMesh.geometry.dispose();
  }
}
