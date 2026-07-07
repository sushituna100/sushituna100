"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PaymentForm({
  reservationId,
  eventId,
  price,
}: {
  reservationId: string;
  eventId: string;
  price: string;
}) {
  const router = useRouter();
  const [card, setCard] = useState({
    name: "",
    number: "",
    expMonth: "",
    expYear: "",
    cvc: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState(false);

  function set<K extends keyof typeof card>(key: K, value: string) {
    setCard((c) => ({ ...c, [key]: value }));
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, card }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Payment failed");
        return;
      }
      setPaid(true);
      setTimeout(() => {
        router.push(`/mixers/${eventId}`);
        router.refresh();
      }, 1200);
    } finally {
      setLoading(false);
    }
  }

  if (paid) {
    return (
      <div className="card border-emerald-200 bg-emerald-50 text-center">
        <p className="text-4xl">✅</p>
        <h2 className="mt-2 text-lg font-bold text-emerald-800">You're in!</h2>
        <p className="mt-1 text-sm text-emerald-700">Seat confirmed — see you there.</p>
      </div>
    );
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <input
        className="input"
        placeholder="Name on card"
        value={card.name}
        onChange={(e) => set("name", e.target.value)}
        required
      />
      <input
        className="input"
        placeholder="Card number"
        inputMode="numeric"
        autoComplete="cc-number"
        value={card.number}
        onChange={(e) => set("number", e.target.value)}
        required
      />
      <div className="flex gap-3">
        <input
          className="input"
          placeholder="MM"
          inputMode="numeric"
          maxLength={2}
          value={card.expMonth}
          onChange={(e) => set("expMonth", e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="YY"
          inputMode="numeric"
          maxLength={4}
          value={card.expYear}
          onChange={(e) => set("expYear", e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="CVC"
          inputMode="numeric"
          maxLength={4}
          value={card.cvc}
          onChange={(e) => set("cvc", e.target.value)}
          required
        />
      </div>

      {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Processing…" : `Pay ${price}`}
      </button>
      <p className="text-center text-xs text-neutral-400">
        Demo checkout — use test card 4242 4242 4242 4242, any future expiry, any CVC.
      </p>
    </form>
  );
}
