/**
 * Left browser: project documents (the "repo of parts"), parameters,
 * bodies, and mass properties for the active part.
 */

import { useMemo } from "react";
import { measureBody } from "../kernel/measure";
import { DEFAULT_MATERIAL } from "../kernel/types";
import { useStore } from "../state/store";

export function BrowserPanel() {
  const documents = useStore((s) => s.documents);
  const activeDoc = useStore((s) => s.activeDoc);
  const doc = useStore((s) => s.doc);
  const evaluation = useStore((s) => s.evaluation);
  const proposalEvaluation = useStore((s) => s.proposalEvaluation);
  const proposals = useStore((s) => s.proposals);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const openDocument = useStore((s) => s.openDocument);
  const deleteDocument = useStore((s) => s.deleteDocument);
  const setDialog = useStore((s) => s.setDialog);
  const project = useStore((s) => s.project);

  const shown = activeDoc && proposals[activeDoc] ? proposalEvaluation : evaluation;

  const massProps = useMemo(() => {
    if (!shown) return [];
    const material = doc?.material ?? DEFAULT_MATERIAL;
    return shown.bodies.map((b) => measureBody(b, material));
  }, [shown, doc]);

  return (
    <div className="browser">
      <div className="panel-header">
        <span title="A project is a folder of parts — the AI has context on all of them.">
          {project ?? "…"} <span className="muted">/ parts</span>
        </span>
        <button className="icon-btn" title="New part" onClick={() => setDialog({ kind: "newDocument" })}>＋</button>
      </div>
      <div className="doc-list">
        {documents.map((name) => (
          <div
            key={name}
            className={`doc-item${name === activeDoc ? " active" : ""}`}
            onClick={() => openDocument(name)}
          >
            <span className="doc-icon">▣</span>
            <span className="doc-name">{name}</span>
            {proposals[name] && <span className="badge-ai" title="AI proposal pending">AI</span>}
            <button
              className="icon-btn doc-delete"
              title="Delete part"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${name}"?`)) deleteDocument(name);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {documents.length === 0 && <div className="muted pad">No parts yet — create one or ask the AI.</div>}
      </div>

      {doc && (
        <>
          <div className="panel-header sub">
            <span>Parameters</span>
            <button className="icon-btn" onClick={() => setDialog({ kind: "parameters" })} title="Edit parameters">✎</button>
          </div>
          <div className="param-list">
            {doc.parameters.map((p) => (
              <div key={p.name} className="param-item" title={p.comment}>
                <span className="param-name">{p.name}</span>
                <span className="param-expr">{String(p.expr)}</span>
                <span className="param-val">{evaluation?.params[p.name]?.toFixed(2) ?? ""}</span>
              </div>
            ))}
            {doc.parameters.length === 0 && <div className="muted pad">No parameters</div>}
          </div>
        </>
      )}

      {shown && shown.bodies.length > 0 && (
        <>
          <div className="panel-header sub"><span>Bodies</span></div>
          <div className="body-list">
            {massProps.map((p) => (
              <div
                key={p.bodyId}
                className={`body-item${selection === p.bodyId ? " selected" : ""}`}
                onClick={() => setSelection(selection === p.bodyId ? null : p.bodyId)}
              >
                <div className="body-line">
                  <span className="doc-icon">◧</span>
                  <span>{p.bodyName}</span>
                </div>
                <div className="body-stats">
                  {(p.volume / 1000).toFixed(2)} cm³ · {p.mass.toFixed(1)} g ·{" "}
                  {p.boundingBox.size.map((v) => v.toFixed(0)).join("×")} mm
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
