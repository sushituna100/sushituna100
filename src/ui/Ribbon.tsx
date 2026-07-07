/** Fusion 360-style ribbon: tabbed tool groups driving dialogs and modes. */

import { exportSTL } from "../kernel/stl";
import { useStore } from "../state/store";

function RibbonButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`ribbon-btn${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
    >
      <span className="ribbon-icon">{icon}</span>
      <span className="ribbon-label">{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-tools">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

export function Ribbon() {
  const tab = useStore((s) => s.ribbonTab);
  const setTab = useStore((s) => s.setRibbonTab);
  const setDialog = useStore((s) => s.setDialog);
  const doc = useStore((s) => s.doc);
  const activeDoc = useStore((s) => s.activeDoc);
  const evaluation = useStore((s) => s.evaluation);
  const sketchMode = useStore((s) => s.sketchMode);
  const setSketchMode = useStore((s) => s.setSketchMode);
  const showSketches = useStore((s) => s.showSketches);
  const setShowSketches = useStore((s) => s.setShowSketches);

  const noDoc = !doc;
  const noBody = !evaluation || evaluation.bodies.length === 0;
  const sketches = doc?.features.filter((f) => f.type === "sketch") ?? [];
  const noSketch = sketches.length === 0;
  const inSketch = sketchMode !== null;

  const downloadSTL = () => {
    if (!evaluation || !activeDoc) return;
    const buffer = exportSTL(evaluation.bodies, activeDoc);
    const blob = new Blob([buffer], { type: "model/stl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeDoc}.stl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="ribbon">
      <div className="ribbon-tabs">
        <div className="brand">
          <span className="brand-mark">◆</span> SolidPilot
        </div>
        {(["solid", "sketch", "modify", "inspect"] as const).map((t) => (
          <button key={t} className={`ribbon-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        {inSketch && (
          <button className="finish-sketch" onClick={() => setSketchMode(null)}>
            ✓ FINISH SKETCH
          </button>
        )}
      </div>

      <div className="ribbon-body">
        {tab === "solid" && (
          <>
            <Group label="Create">
              <RibbonButton icon="▤" label="Sketch" disabled={noDoc}
                onClick={() => setDialog({ kind: "feature", featureType: "sketch" })} />
              <RibbonButton icon="⬆" label="Extrude" disabled={noDoc || noSketch}
                onClick={() => setDialog({ kind: "feature", featureType: "extrude" })} />
              <RibbonButton icon="◐" label="Revolve" disabled={noDoc || noSketch}
                onClick={() => setDialog({ kind: "feature", featureType: "revolve" })} />
            </Group>
            <Group label="Primitives">
              <RibbonButton icon="▧" label="Box" disabled={noDoc}
                onClick={() => setDialog({ kind: "feature", featureType: "primitive" })} />
              <RibbonButton icon="⬤" label="Sphere" disabled={noDoc}
                onClick={() => setDialog({ kind: "feature", featureType: "primitive" })} />
              <RibbonButton icon="◎" label="Torus" disabled={noDoc}
                onClick={() => setDialog({ kind: "feature", featureType: "primitive" })} />
            </Group>
            <Group label="Setup">
              <RibbonButton icon="ƒ" label="Parameters" disabled={noDoc}
                onClick={() => setDialog({ kind: "parameters" })} />
            </Group>
          </>
        )}

        {tab === "sketch" && (
          <>
            <Group label="Draw (click in viewport)">
              <RibbonButton icon="▭" label="Rectangle" disabled={!inSketch}
                active={sketchMode?.tool === "rect"}
                onClick={() => sketchMode && setSketchMode({ ...sketchMode, tool: sketchMode.tool === "rect" ? null : "rect" })} />
              <RibbonButton icon="○" label="Circle" disabled={!inSketch}
                active={sketchMode?.tool === "circle"}
                onClick={() => sketchMode && setSketchMode({ ...sketchMode, tool: sketchMode.tool === "circle" ? null : "circle" })} />
            </Group>
            <Group label="Add by dimensions">
              <RibbonButton icon="▭" label="Rectangle" disabled={!inSketch}
                onClick={() => sketchMode && setDialog({ kind: "sketchEntity", sketchId: sketchMode.sketchId, entityKind: "rect" })} />
              <RibbonButton icon="○" label="Circle" disabled={!inSketch}
                onClick={() => sketchMode && setDialog({ kind: "sketchEntity", sketchId: sketchMode.sketchId, entityKind: "circle" })} />
              <RibbonButton icon="⬭" label="Slot" disabled={!inSketch}
                onClick={() => sketchMode && setDialog({ kind: "sketchEntity", sketchId: sketchMode.sketchId, entityKind: "slot" })} />
              <RibbonButton icon="⬡" label="N-gon" disabled={!inSketch}
                onClick={() => sketchMode && setDialog({ kind: "sketchEntity", sketchId: sketchMode.sketchId, entityKind: "ngon" })} />
            </Group>
            <Group label="Sketch">
              <RibbonButton icon="▤" label="New Sketch" disabled={noDoc}
                onClick={() => setDialog({ kind: "feature", featureType: "sketch" })} />
            </Group>
            {!inSketch && (
              <div className="ribbon-note">Create a sketch (or click one in the timeline) to start drawing.</div>
            )}
          </>
        )}

        {tab === "modify" && (
          <>
            <Group label="Boolean">
              <RibbonButton icon="⊕" label="Combine" disabled={noBody}
                onClick={() => setDialog({ kind: "feature", featureType: "combine" })} />
            </Group>
            <Group label="Placement">
              <RibbonButton icon="✥" label="Move/Rotate" disabled={noBody}
                onClick={() => setDialog({ kind: "feature", featureType: "transform" })} />
              <RibbonButton icon="⧉" label="Mirror" disabled={noBody}
                onClick={() => setDialog({ kind: "feature", featureType: "mirror" })} />
              <RibbonButton icon="⁘" label="Pattern" disabled={noBody}
                onClick={() => setDialog({ kind: "feature", featureType: "pattern" })} />
            </Group>
          </>
        )}

        {tab === "inspect" && (
          <>
            <Group label="Display">
              <RibbonButton icon="▤" label={showSketches ? "Hide Sketches" : "Show Sketches"}
                onClick={() => setShowSketches(!showSketches)} disabled={noDoc} />
            </Group>
            <Group label="Export">
              <RibbonButton icon="⬇" label="STL" disabled={noBody} onClick={downloadSTL} />
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
