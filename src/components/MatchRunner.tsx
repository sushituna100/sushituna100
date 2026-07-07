"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Demo control: in production matching runs automatically when booking
// closes; here a confirmed guest can trigger it to see the magic happen.
export default function MatchRunner({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/events/${eventId}/match`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Matching failed");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card border-dashed border-brand-200 bg-brand-50/50 text-center">
      <p className="text-sm text-neutral-600">
        Matching normally runs when booking closes. Want a sneak peek?
      </p>
      <button
        className="btn-secondary mt-3 border-brand-300 !text-brand-700"
        onClick={run}
        disabled={loading}
      >
        {loading ? "Matching…" : "✨ Run matching now (demo)"}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
