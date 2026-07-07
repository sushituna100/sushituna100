"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";

type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string; avatarEmoji: string; avatarColor: string };
};

export default function Chat({
  endpoint,
  currentUserId,
}: {
  endpoint: string;
  currentUserId: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages);
    } catch {
      // network hiccup — next poll will retry
    }
  }, [endpoint]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({
      behavior: firstLoad.current ? "auto" : "smooth",
      block: "nearest",
    });
    firstLoad.current = false;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) await load();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-neutral-100 bg-neutral-50">
      <div className="flex max-h-80 min-h-40 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-400">
            No messages yet — say hi! 👋
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender.id === currentUserId;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              <Avatar emoji={m.sender.avatarEmoji} color={m.sender.avatarColor} size={28} />
              <div className={`max-w-[75%] ${mine ? "text-right" : ""}`}>
                {!mine && (
                  <p className="mb-0.5 px-1 text-[11px] font-semibold text-neutral-400">
                    {m.sender.name}
                  </p>
                )}
                <div
                  className={`inline-block rounded-2xl px-3.5 py-2 text-sm ${
                    mine
                      ? "rounded-br-md bg-brand-600 text-white"
                      : "rounded-bl-md border border-neutral-200 bg-white text-neutral-800"
                  }`}
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-neutral-100 p-3">
        <input
          className="input py-2.5"
          placeholder="Message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="shrink-0 rounded-xl bg-brand-600 px-4 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
