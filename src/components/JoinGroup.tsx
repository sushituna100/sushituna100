"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function JoinGroup({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function join() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3 className="font-bold">Ask to join</h3>
      <textarea
        className="input mt-3 h-20 resize-none"
        placeholder="Tell them why you'd be a great addition…"
        value={message}
        maxLength={300}
        onChange={(e) => setMessage(e.target.value)}
      />
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
      <button className="btn-primary mt-3" onClick={join} disabled={loading}>
        {loading ? "Sending…" : "Send join request"}
      </button>
    </div>
  );
}
