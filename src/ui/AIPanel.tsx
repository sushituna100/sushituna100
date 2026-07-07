/**
 * AI copilot panel: chat with project-wide context, live tool activity,
 * and Cursor-style accept/reject banners for proposed geometry edits.
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

const SUGGESTIONS = [
  "Design a mounting bracket: 80×50×6 mm base, two M5 clearance holes 60 mm apart, a vertical flange with a 10 mm lightening slot.",
  "Reduce this part's mass by 20% without changing its footprint. Report before/after mass.",
  "Read all parts in this project and create a matching lid for the enclosure with 0.3 mm clearance.",
  "Make the wall thickness a parameter and set it to 2.5 mm everywhere.",
];

export function AIPanel() {
  const chat = useStore((s) => s.chat);
  const aiBusy = useStore((s) => s.aiBusy);
  const aiAvailable = useStore((s) => s.aiAvailable);
  const aiModel = useStore((s) => s.aiModel);
  const sendChat = useStore((s) => s.sendChat);
  const proposals = useStore((s) => s.proposals);
  const acceptProposal = useStore((s) => s.acceptProposal);
  const rejectProposal = useStore((s) => s.rejectProposal);
  const openDocument = useStore((s) => s.openDocument);
  const activeDoc = useStore((s) => s.activeDoc);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat, proposals]);

  const send = () => {
    const text = input.trim();
    if (!text || aiBusy) return;
    setInput("");
    void sendChat(text);
  };

  const pending = Object.values(proposals);

  return (
    <div className="ai-panel">
      <div className="panel-header">
        <span>◆ Copilot</span>
        <span className="muted small">{aiModel}</span>
      </div>

      {aiAvailable === false && (
        <div className="ai-warning">
          Copilot disabled — set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and restart the server.
        </div>
      )}

      <div className="chat" ref={scrollRef}>
        {chat.length === 0 && (
          <div className="chat-empty">
            <p>
              I can see <b>every part in this project</b>, design new parts from a prompt, and modify
              geometry to hit targets (mass, dimensions, clearances). Changes appear in your viewport
              as proposals you accept or reject.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((item, i) =>
          item.role === "event" ? (
            <div key={i} className={`chat-event${item.kind === "error" ? " error" : ""}`}>
              {item.content}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${item.role}`}>
              {item.content}
            </div>
          ),
        )}
        {aiBusy && <div className="chat-event pulsing">thinking…</div>}
      </div>

      {pending.length > 0 && (
        <div className="proposals">
          {pending.map((p) => (
            <div key={p.name} className="proposal">
              <div className="proposal-head">
                <span>
                  {p.created ? "New part" : "Edit"}: <b>{p.name}</b>
                </span>
                {activeDoc !== p.name && (
                  <button className="link" onClick={() => openDocument(p.name)}>preview</button>
                )}
              </div>
              {p.rationale && <div className="proposal-rationale">{p.rationale}</div>}
              <div className="proposal-actions">
                <button className="accept" onClick={() => acceptProposal(p.name)}>✓ Accept</button>
                <button className="reject" onClick={() => rejectProposal(p.name)}>✕ Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input">
        <textarea
          value={input}
          placeholder={aiBusy ? "Copilot is working…" : "Describe a part, a change, or a target…"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={3}
          disabled={aiAvailable === false}
        />
        <button className="primary" onClick={send} disabled={aiBusy || !input.trim() || aiAvailable === false}>
          {aiBusy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
