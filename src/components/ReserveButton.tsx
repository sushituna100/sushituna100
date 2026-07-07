"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReserveButton({ eventId, price }: { eventId: string; price: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function reserve() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push(`/checkout/${data.reservationId}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn-primary" onClick={reserve} disabled={loading}>
        {loading ? "Reserving…" : `Reserve my seat · ${price}`}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}
    </div>
  );
}
