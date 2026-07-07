"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RequestActions({
  groupId,
  requestId,
}: {
  groupId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function act(action: "approve" | "decline") {
    setLoading(true);
    try {
      await fetch(`/api/groups/${groupId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-2">
      <button
        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        onClick={() => act("approve")}
        disabled={loading}
      >
        Approve
      </button>
      <button
        className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
        onClick={() => act("decline")}
        disabled={loading}
      >
        Decline
      </button>
    </div>
  );
}
