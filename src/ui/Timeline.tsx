/** Bottom feature timeline (Fusion-style): click to edit, suppress, delete, reorder. */

import type { Feature } from "../kernel/types";
import { useStore } from "../state/store";

const ICONS: Record<Feature["type"], string> = {
  sketch: "▤",
  extrude: "⬆",
  revolve: "◐",
  primitive: "▧",
  combine: "⊕",
  transform: "✥",
  mirror: "⧉",
  pattern: "⁘",
  loft: "◭",
  shell: "▢",
};

export function Timeline() {
  const doc = useStore((s) => s.doc);
  const evaluation = useStore((s) => s.evaluation);
  const updateDoc = useStore((s) => s.updateDoc);
  const setDialog = useStore((s) => s.setDialog);
  const setSketchMode = useStore((s) => s.setSketchMode);

  if (!doc) return <div className="timeline empty">No part open</div>;

  const errorIds = new Set(evaluation?.errors.map((e) => e.featureId));

  const onClickFeature = (f: Feature) => {
    if (f.type === "sketch") {
      setSketchMode({ sketchId: f.id, tool: null });
    } else {
      setDialog({ kind: "feature", featureType: f.type, editId: f.id });
    }
  };

  const move = (index: number, dir: -1 | 1) => {
    updateDoc((d) => {
      const j = index + dir;
      if (j < 0 || j >= d.features.length) return;
      const [f] = d.features.splice(index, 1);
      d.features.splice(j, 0, f);
    });
  };

  return (
    <div className="timeline">
      {doc.features.map((f, i) => (
        <div
          key={f.id}
          className={`timeline-item${f.suppressed ? " suppressed" : ""}${errorIds.has(f.id) ? " error" : ""}`}
          title={`${f.type}${f.name ? `: ${f.name}` : ""}${
            errorIds.has(f.id)
              ? `\nERROR: ${evaluation?.errors.find((e) => e.featureId === f.id)?.message}`
              : ""
          }\nclick = edit · ⏸ = suppress · ← → = reorder`}
        >
          <button className="timeline-feature" onClick={() => onClickFeature(f)}>
            <span className="timeline-icon">{ICONS[f.type]}</span>
          </button>
          <div className="timeline-actions">
            <button onClick={() => move(i, -1)} title="Move earlier">‹</button>
            <button
              onClick={() =>
                updateDoc((d) => {
                  const target = d.features.find((x) => x.id === f.id);
                  if (target) target.suppressed = !target.suppressed;
                })
              }
              title={f.suppressed ? "Unsuppress" : "Suppress"}
            >
              ⏸
            </button>
            <button
              onClick={() => updateDoc((d) => (d.features = d.features.filter((x) => x.id !== f.id)))}
              title="Delete feature"
            >
              ✕
            </button>
            <button onClick={() => move(i, 1)} title="Move later">›</button>
          </div>
        </div>
      ))}
      {doc.features.length === 0 && (
        <span className="muted pad">Timeline is empty — sketch + extrude, drop a primitive, or ask the AI.</span>
      )}
    </div>
  );
}
