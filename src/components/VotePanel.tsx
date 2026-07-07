"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function VotePanel({
  matchGroupId,
  myVote,
  yesVotes,
  memberCount,
  friendGroupId,
}: {
  matchGroupId: string;
  myVote: boolean | null;
  yesVotes: number;
  memberCount: number;
  friendGroupId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function vote(keepGoing: boolean) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/match-groups/${matchGroupId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepGoing }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vote failed");
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (friendGroupId) {
    return (
      <div className="card border-emerald-200 bg-emerald-50 text-center">
        <p className="text-3xl">🎉</p>
        <h3 className="mt-1 font-bold text-emerald-800">This table is now a friend group!</h3>
        <p className="mt-1 text-sm text-emerald-700">
          The votes are in — you all decided to keep hanging out.
        </p>
        {myVote === null || myVote === false ? (
          <button
            className="btn-primary mt-4 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => vote(true)}
            disabled={loading}
          >
            {loading ? "Joining…" : "Vote yes & join them"}
          </button>
        ) : (
          <Link
            href={`/groups/${friendGroupId}`}
            className="btn-primary mt-4 bg-emerald-600 hover:bg-emerald-700"
          >
            Open your friend group ›
          </Link>
        )}
        {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card border-brand-100 bg-brand-50/50">
      <h3 className="font-bold">Keep this group going? 💜</h3>
      <p className="mt-1 text-sm text-neutral-600">
        If a majority votes yes, this table becomes a permanent friend group with its own chat
        and hangouts.
      </p>
      <p className="mt-2 text-sm font-semibold text-brand-700">
        {yesVotes} of {memberCount} voted yes so far
      </p>
      <div className="mt-4 flex gap-3">
        <button
          className={`btn-secondary ${myVote === false ? "border-neutral-400 bg-neutral-100" : ""}`}
          onClick={() => vote(false)}
          disabled={loading}
        >
          Not for me
        </button>
        <button
          className={`btn-primary ${myVote === true ? "opacity-70" : ""}`}
          onClick={() => vote(true)}
          disabled={loading}
        >
          {myVote === true ? "You voted yes ✓" : "Yes, let's stay friends"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
