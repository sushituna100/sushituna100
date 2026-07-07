/**
 * Modal dialogs: feature creation/editing forms, sketch entities,
 * parameter table, new document. Numeric fields accept expressions.
 */

import { useMemo, useState } from "react";
import type {
  CadDocument,
  Expr,
  Feature,
  SketchEntity,
  SketchFeature,
} from "../kernel/types";
import { newId } from "../kernel/types";
import { useStore, type DialogKind } from "../state/store";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="form-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

const num = (v: string): Expr => {
  const trimmed = v.trim();
  if (trimmed === "") return 0;
  const asNum = Number(trimmed);
  return Number.isFinite(asNum) ? asNum : trimmed;
};

/* ------------------------------ dialog router ------------------------------ */

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "feature":
      return <FeatureDialog dialog={dialog} />;
    case "parameters":
      return <ParametersDialog />;
    case "newDocument":
      return <NewDocumentDialog />;
    case "sketchEntity":
      return <SketchEntityDialog dialog={dialog} />;
  }
}

/* ------------------------------ new document ------------------------------ */

function NewDocumentDialog() {
  const [name, setName] = useState("");
  const setDialog = useStore((s) => s.setDialog);
  const createDocument = useStore((s) => s.createDocument);
  return (
    <Modal title="New Part" onClose={() => setDialog(null)}>
      <Row label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="bracket" />
      </Row>
      <div className="modal-actions">
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={async () => {
            await createDocument(name.trim());
            setDialog(null);
          }}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ parameters ------------------------------ */

function ParametersDialog() {
  const doc = useStore((s) => s.doc);
  const updateDoc = useStore((s) => s.updateDoc);
  const setDialog = useStore((s) => s.setDialog);
  const evaluation = useStore((s) => s.evaluation);
  const [rows, setRows] = useState(() =>
    (doc?.parameters ?? []).map((p) => ({ name: p.name, expr: String(p.expr), comment: p.comment ?? "" })),
  );
  if (!doc) return null;

  const save = () => {
    updateDoc((d) => {
      d.parameters = rows
        .filter((r) => r.name.trim())
        .map((r) => ({ name: r.name.trim(), expr: num(r.expr), comment: r.comment || undefined }));
    });
    setDialog(null);
  };

  return (
    <Modal title="Parameters" onClose={() => setDialog(null)}>
      <table className="param-table">
        <thead>
          <tr><th>Name</th><th>Expression</th><th>Value</th><th>Comment</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
              <td><input value={r.expr} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, expr: e.target.value } : x)))} /></td>
              <td className="param-value">{evaluation?.params[r.name]?.toFixed(3) ?? "—"}</td>
              <td><input value={r.comment} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} /></td>
              <td><button className="icon-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-actions">
        <button onClick={() => setRows([...rows, { name: "", expr: "10", comment: "" }])}>+ Add</button>
        <button className="primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

/* ------------------------------ sketch entities ------------------------------ */

function SketchEntityDialog({ dialog }: { dialog: Extract<DialogKind, { kind: "sketchEntity" }> }) {
  const doc = useStore((s) => s.doc);
  const updateDoc = useStore((s) => s.updateDoc);
  const setDialog = useStore((s) => s.setDialog);

  const sketch = doc?.features.find((f) => f.id === dialog.sketchId && f.type === "sketch") as SketchFeature | undefined;
  const editing = sketch?.entities.find((e) => e.id === dialog.editEntityId);

  const [v, setV] = useState<Record<string, string>>(() => {
    const e = editing as Record<string, unknown> | undefined;
    const g = (key: string, fallback: string) => (e && e[key] !== undefined ? String(e[key]) : fallback);
    return {
      cx: g("cx", "0"), cy: g("cy", "0"),
      width: g("width", "40"), height: g("height", "20"), cornerRadius: g("cornerRadius", "0"),
      radius: g("radius", "10"),
      x1: g("x1", "-10"), y1: g("y1", "0"), x2: g("x2", "10"), y2: g("y2", "0"), slotWidth: g("width", "6"),
      sides: g("sides", "6"), rotation: g("rotation", "0"),
      hole: editing?.hole ? "1" : "",
    };
  });
  if (!sketch) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const buildEntity = (): SketchEntity => {
    const id = editing?.id ?? newId("e");
    const hole = v.hole === "1" ? true : undefined;
    switch (dialog.entityKind) {
      case "rect": {
        const r = num(v.cornerRadius);
        return { id, kind: "rect", cx: num(v.cx), cy: num(v.cy), width: num(v.width), height: num(v.height),
          cornerRadius: r === 0 ? undefined : r, hole };
      }
      case "circle":
        return { id, kind: "circle", cx: num(v.cx), cy: num(v.cy), radius: num(v.radius), hole };
      case "slot":
        return { id, kind: "slot", x1: num(v.x1), y1: num(v.y1), x2: num(v.x2), y2: num(v.y2), width: num(v.slotWidth), hole };
      case "ngon":
        return { id, kind: "ngon", cx: num(v.cx), cy: num(v.cy), radius: num(v.radius), sides: num(v.sides),
          rotation: num(v.rotation) === 0 ? undefined : num(v.rotation), hole };
    }
  };

  const save = () => {
    updateDoc((d) => {
      const sk = d.features.find((f) => f.id === dialog.sketchId) as SketchFeature | undefined;
      if (!sk) return;
      const entity = buildEntity();
      const idx = sk.entities.findIndex((e) => e.id === entity.id);
      if (idx >= 0) sk.entities[idx] = entity;
      else sk.entities.push(entity);
    });
    setDialog(null);
  };

  const titles = { rect: "Rectangle", circle: "Circle", slot: "Slot", ngon: "Polygon (N-gon)" };
  return (
    <Modal title={`${editing ? "Edit" : "Add"} ${titles[dialog.entityKind]}`} onClose={() => setDialog(null)}>
      {dialog.entityKind === "rect" && (
        <>
          <Row label="Center X"><input value={v.cx} onChange={set("cx")} /></Row>
          <Row label="Center Y"><input value={v.cy} onChange={set("cy")} /></Row>
          <Row label="Width"><input value={v.width} onChange={set("width")} /></Row>
          <Row label="Height"><input value={v.height} onChange={set("height")} /></Row>
          <Row label="Corner radius"><input value={v.cornerRadius} onChange={set("cornerRadius")} /></Row>
        </>
      )}
      {dialog.entityKind === "circle" && (
        <>
          <Row label="Center X"><input value={v.cx} onChange={set("cx")} /></Row>
          <Row label="Center Y"><input value={v.cy} onChange={set("cy")} /></Row>
          <Row label="Radius"><input value={v.radius} onChange={set("radius")} /></Row>
        </>
      )}
      {dialog.entityKind === "slot" && (
        <>
          <Row label="X1"><input value={v.x1} onChange={set("x1")} /></Row>
          <Row label="Y1"><input value={v.y1} onChange={set("y1")} /></Row>
          <Row label="X2"><input value={v.x2} onChange={set("x2")} /></Row>
          <Row label="Y2"><input value={v.y2} onChange={set("y2")} /></Row>
          <Row label="Width"><input value={v.slotWidth} onChange={set("slotWidth")} /></Row>
        </>
      )}
      {dialog.entityKind === "ngon" && (
        <>
          <Row label="Center X"><input value={v.cx} onChange={set("cx")} /></Row>
          <Row label="Center Y"><input value={v.cy} onChange={set("cy")} /></Row>
          <Row label="Radius"><input value={v.radius} onChange={set("radius")} /></Row>
          <Row label="Sides"><input value={v.sides} onChange={set("sides")} /></Row>
          <Row label="Rotation °"><input value={v.rotation} onChange={set("rotation")} /></Row>
        </>
      )}
      <Row label="Hole (cut from profile)">
        <input type="checkbox" checked={v.hole === "1"} onChange={(e) => setV({ ...v, hole: e.target.checked ? "1" : "" })} />
      </Row>
      <div className="modal-actions">
        <button className="primary" onClick={save}>{editing ? "Save" : "Add"}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------ features ------------------------------ */

function FeatureDialog({ dialog }: { dialog: Extract<DialogKind, { kind: "feature" }> }) {
  const doc = useStore((s) => s.doc);
  const evaluation = useStore((s) => s.evaluation);
  const updateDoc = useStore((s) => s.updateDoc);
  const setDialog = useStore((s) => s.setDialog);
  const setSketchMode = useStore((s) => s.setSketchMode);
  const selection = useStore((s) => s.selection);

  const editing = doc?.features.find((f) => f.id === dialog.editId);
  const sketches = useMemo(
    () => (doc?.features.filter((f) => f.type === "sketch") ?? []) as SketchFeature[],
    [doc],
  );
  const bodies = evaluation?.bodies ?? [];

  const [v, setV] = useState<Record<string, string>>(() => initialValues(dialog.featureType, editing, {
    firstSketch: sketches[sketches.length - 1]?.id ?? "",
    firstBody: selection ?? bodies[0]?.id ?? "",
  }));
  if (!doc) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target.value });

  const save = () => {
    const feature = buildFeature(dialog.featureType, v, editing?.id);
    updateDoc((d) => {
      if (editing) {
        const idx = d.features.findIndex((f) => f.id === editing.id);
        if (idx >= 0) d.features[idx] = { ...feature, id: editing.id };
      } else {
        d.features.push(feature);
      }
    });
    setDialog(null);
    if (!editing && feature.type === "sketch") {
      setSketchMode({ sketchId: feature.id, tool: null });
    }
  };

  const opSelect = (
    <select value={v.op} onChange={set("op")}>
      <option value="new">New body</option>
      <option value="join">Join</option>
      <option value="cut">Cut</option>
      <option value="intersect">Intersect</option>
    </select>
  );
  const targetSelect = (
    <select value={v.target} onChange={set("target")}>
      <option value="">(first body)</option>
      {bodies.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
  const bodySelect = (key: string) => (
    <select value={v[key]} onChange={set(key)}>
      {bodies.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );
  const sketchSelect = (
    <select value={v.sketch} onChange={set("sketch")}>
      {sketches.map((s) => (
        <option key={s.id} value={s.id}>{s.name ?? s.id}</option>
      ))}
    </select>
  );

  const t = dialog.featureType;
  const title = `${editing ? "Edit" : "Create"} ${t[0].toUpperCase() + t.slice(1)}`;

  return (
    <Modal title={title} onClose={() => setDialog(null)}>
      {t === "sketch" && (
        <>
          <Row label="Plane">
            <select value={v.plane} onChange={set("plane")}>
              <option value="XY">XY (top)</option>
              <option value="XZ">XZ (front)</option>
              <option value="YZ">YZ (right)</option>
            </select>
          </Row>
          <Row label="Offset"><input value={v.offset} onChange={set("offset")} /></Row>
          <Row label="Name"><input value={v.name} onChange={set("name")} /></Row>
        </>
      )}
      {t === "extrude" && (
        <>
          <Row label="Profile">{sketchSelect}</Row>
          <Row label="Distance"><input value={v.distance} onChange={set("distance")} /></Row>
          <Row label="Direction">
            <select value={v.direction} onChange={set("direction")}>
              <option value="1">Normal</option>
              <option value="-1">Reversed</option>
              <option value="symmetric">Symmetric</option>
            </select>
          </Row>
          <Row label="Operation">{opSelect}</Row>
          {v.op !== "new" && <Row label="Target">{targetSelect}</Row>}
        </>
      )}
      {t === "revolve" && (
        <>
          <Row label="Profile">{sketchSelect}</Row>
          <Row label="Axis">
            <select value={v.axis} onChange={set("axis")}>
              <option value="y">Vertical (sketch Y)</option>
              <option value="x">Horizontal (sketch X)</option>
            </select>
          </Row>
          <Row label="Axis offset"><input value={v.axisOffset} onChange={set("axisOffset")} /></Row>
          <Row label="Operation">{opSelect}</Row>
          {v.op !== "new" && <Row label="Target">{targetSelect}</Row>}
        </>
      )}
      {t === "primitive" && (
        <>
          <Row label="Shape">
            <select value={v.kind} onChange={set("kind")}>
              <option value="box">Box</option>
              <option value="cylinder">Cylinder</option>
              <option value="sphere">Sphere</option>
              <option value="torus">Torus</option>
            </select>
          </Row>
          {v.kind === "box" && (
            <>
              <Row label="Width (X)"><input value={v.s0} onChange={set("s0")} /></Row>
              <Row label="Depth (Y)"><input value={v.s1} onChange={set("s1")} /></Row>
              <Row label="Height (Z)"><input value={v.s2} onChange={set("s2")} /></Row>
            </>
          )}
          {v.kind === "cylinder" && (
            <>
              <Row label="Radius"><input value={v.s0} onChange={set("s0")} /></Row>
              <Row label="Height"><input value={v.s1} onChange={set("s1")} /></Row>
            </>
          )}
          {v.kind === "sphere" && <Row label="Radius"><input value={v.s0} onChange={set("s0")} /></Row>}
          {v.kind === "torus" && (
            <>
              <Row label="Radius"><input value={v.s0} onChange={set("s0")} /></Row>
              <Row label="Tube radius"><input value={v.s1} onChange={set("s1")} /></Row>
            </>
          )}
          <Row label="Center at (x,y,z)">
            <div className="triple">
              <input value={v.ax} onChange={set("ax")} />
              <input value={v.ay} onChange={set("ay")} />
              <input value={v.az} onChange={set("az")} />
            </div>
          </Row>
          <Row label="Operation">{opSelect}</Row>
          {v.op !== "new" && <Row label="Target">{targetSelect}</Row>}
        </>
      )}
      {t === "combine" && (
        <>
          <Row label="Operation">
            <select value={v.op} onChange={set("op")}>
              <option value="join">Join</option>
              <option value="cut">Cut</option>
              <option value="intersect">Intersect</option>
            </select>
          </Row>
          <Row label="Target">{bodySelect("target")}</Row>
          <Row label="Tool">{bodySelect("tool")}</Row>
        </>
      )}
      {t === "transform" && (
        <>
          <Row label="Body">{bodySelect("body")}</Row>
          <Row label="Translate (x,y,z)">
            <div className="triple">
              <input value={v.tx} onChange={set("tx")} />
              <input value={v.ty} onChange={set("ty")} />
              <input value={v.tz} onChange={set("tz")} />
            </div>
          </Row>
          <Row label="Rotate ° (x,y,z)">
            <div className="triple">
              <input value={v.rx} onChange={set("rx")} />
              <input value={v.ry} onChange={set("ry")} />
              <input value={v.rz} onChange={set("rz")} />
            </div>
          </Row>
          <Row label="Scale"><input value={v.scale} onChange={set("scale")} /></Row>
        </>
      )}
      {t === "mirror" && (
        <>
          <Row label="Body">{bodySelect("body")}</Row>
          <Row label="Mirror plane">
            <select value={v.plane} onChange={set("plane")}>
              <option value="XY">XY</option>
              <option value="XZ">XZ</option>
              <option value="YZ">YZ</option>
            </select>
          </Row>
          <Row label="Plane offset"><input value={v.offset} onChange={set("offset")} /></Row>
          <Row label="Merge into body">
            <input type="checkbox" checked={v.merge === "1"} onChange={(e) => setV({ ...v, merge: e.target.checked ? "1" : "" })} />
          </Row>
        </>
      )}
      {t === "pattern" && (
        <>
          <Row label="Body">{bodySelect("body")}</Row>
          <Row label="Type">
            <select value={v.patKind} onChange={set("patKind")}>
              <option value="linear">Linear</option>
              <option value="circular">Circular</option>
            </select>
          </Row>
          <Row label="Count"><input value={v.count} onChange={set("count")} /></Row>
          {v.patKind === "linear" ? (
            <Row label="Spacing (x,y,z)">
              <div className="triple">
                <input value={v.sx} onChange={set("sx")} />
                <input value={v.sy} onChange={set("sy")} />
                <input value={v.sz} onChange={set("sz")} />
              </div>
            </Row>
          ) : (
            <>
              <Row label="Axis">
                <select value={v.axis} onChange={set("axis")}>
                  <option value="z">Z</option>
                  <option value="x">X</option>
                  <option value="y">Y</option>
                </select>
              </Row>
              <Row label="Total angle °"><input value={v.totalAngle} onChange={set("totalAngle")} /></Row>
            </>
          )}
        </>
      )}
      <div className="modal-actions">
        <button className="primary" onClick={save}>{editing ? "Save" : "OK"}</button>
      </div>
    </Modal>
  );
}

function initialValues(
  type: Feature["type"],
  editing: Feature | undefined,
  defaults: { firstSketch: string; firstBody: string },
): Record<string, string> {
  const e = editing as unknown as Record<string, unknown> | undefined;
  const g = (key: string, fallback: string) => (e && e[key] !== undefined ? String(e[key]) : fallback);
  const arr = (key: string, i: number, fallback: string) => {
    const a = e?.[key] as unknown[] | undefined;
    return a && a[i] !== undefined ? String(a[i]) : fallback;
  };
  switch (type) {
    case "sketch":
      return {
        plane: e ? String((e.plane as { plane: string }).plane) : "XY",
        offset: e ? String((e.plane as { offset?: unknown }).offset ?? "0") : "0",
        name: g("name", "Sketch"),
      };
    case "extrude":
      return { sketch: g("sketch", defaults.firstSketch), distance: g("distance", "10"),
        direction: g("direction", "1"), op: g("op", "new"), target: g("target", "") };
    case "revolve":
      return { sketch: g("sketch", defaults.firstSketch), axis: g("axis", "y"),
        axisOffset: g("axisOffset", "0"), op: g("op", "new"), target: g("target", "") };
    case "primitive":
      return { kind: g("kind", "box"), s0: arr("size", 0, "40"), s1: arr("size", 1, "30"), s2: arr("size", 2, "20"),
        ax: arr("at", 0, "0"), ay: arr("at", 1, "0"), az: arr("at", 2, "0"), op: g("op", "new"), target: g("target", "") };
    case "combine":
      return { op: g("op", "cut"), target: g("target", defaults.firstBody),
        tool: e ? String((e.tools as string[])[0] ?? "") : defaults.firstBody };
    case "transform":
      return { body: g("body", defaults.firstBody), tx: arr("translate", 0, "0"), ty: arr("translate", 1, "0"),
        tz: arr("translate", 2, "0"), rx: arr("rotate", 0, "0"), ry: arr("rotate", 1, "0"),
        rz: arr("rotate", 2, "0"), scale: g("scale", "1") };
    case "mirror":
      return { body: g("body", defaults.firstBody), plane: g("plane", "YZ"), offset: g("planeOffset", "0"),
        merge: editing && (editing as { merge?: boolean }).merge === false ? "" : "1" };
    case "pattern":
      return { body: g("body", defaults.firstBody), patKind: g("kind", "linear"), count: g("count", "3"),
        sx: arr("spacing", 0, "20"), sy: arr("spacing", 1, "0"), sz: arr("spacing", 2, "0"),
        axis: g("axis", "z"), totalAngle: g("totalAngle", "360") };
  }
}

function buildFeature(type: Feature["type"], v: Record<string, string>, existingId?: string): Feature {
  const id = existingId ?? newId(type.slice(0, 2));
  switch (type) {
    case "sketch":
      return { id, type, name: v.name || "Sketch",
        plane: { plane: v.plane as "XY" | "XZ" | "YZ", offset: num(v.offset) || undefined }, entities: [] };
    case "extrude":
      return { id, type, sketch: v.sketch, distance: num(v.distance),
        direction: v.direction === "symmetric" ? "symmetric" : v.direction === "-1" ? -1 : 1,
        op: v.op as "new" | "join" | "cut" | "intersect",
        target: v.target || undefined };
    case "revolve":
      return { id, type, sketch: v.sketch, axis: v.axis as "x" | "y",
        axisOffset: num(v.axisOffset) || undefined,
        op: v.op as "new" | "join" | "cut" | "intersect", target: v.target || undefined };
    case "primitive": {
      const kind = v.kind as "box" | "cylinder" | "sphere" | "torus";
      const size = kind === "box" ? [num(v.s0), num(v.s1), num(v.s2)]
        : kind === "sphere" ? [num(v.s0)] : [num(v.s0), num(v.s1)];
      const at: [Expr, Expr, Expr] = [num(v.ax), num(v.ay), num(v.az)];
      const hasAt = at.some((x) => x !== 0);
      return { id, type, kind, size, at: hasAt ? at : undefined,
        op: v.op as "new" | "join" | "cut" | "intersect", target: v.target || undefined };
    }
    case "combine":
      return { id, type, op: v.op as "join" | "cut" | "intersect", target: v.target, tools: [v.tool] };
    case "transform": {
      const tr: [Expr, Expr, Expr] = [num(v.tx), num(v.ty), num(v.tz)];
      const ro: [Expr, Expr, Expr] = [num(v.rx), num(v.ry), num(v.rz)];
      return { id, type, body: v.body,
        translate: tr.some((x) => x !== 0) ? tr : undefined,
        rotate: ro.some((x) => x !== 0) ? ro : undefined,
        scale: v.scale !== "1" && v.scale !== "" ? num(v.scale) : undefined };
    }
    case "mirror":
      return { id, type, body: v.body, plane: v.plane as "XY" | "XZ" | "YZ",
        planeOffset: num(v.offset) || undefined, merge: v.merge === "1" ? undefined : false };
    case "pattern": {
      const kind = v.patKind as "linear" | "circular";
      return { id, type, kind, body: v.body, count: num(v.count),
        spacing: kind === "linear" ? [num(v.sx), num(v.sy), num(v.sz)] : undefined,
        axis: kind === "circular" ? (v.axis as "x" | "y" | "z") : undefined,
        totalAngle: kind === "circular" && v.totalAngle !== "360" ? num(v.totalAngle) : undefined };
    }
  }
}
