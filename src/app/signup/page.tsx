"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", age: "", city: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, age: Number(form.age) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/onboarding");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="px-6 py-10">
      <Link href="/" className="text-sm font-semibold text-brand-600">
        ‹ Back
      </Link>
      <h1 className="mt-6 text-3xl font-extrabold">Create your account</h1>
      <p className="mt-2 text-neutral-500">Your future friend group is waiting.</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          className="input"
          placeholder="First name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password (8+ characters)"
          value={form.password}
          onChange={(e) => set("password", e.target.value)}
          minLength={8}
          required
        />
        <div className="flex gap-4">
          <input
            className="input"
            type="number"
            placeholder="Age"
            min={18}
            max={120}
            value={form.age}
            onChange={(e) => set("age", e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="City"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Creating account…" : "Continue"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Already on Mixer?{" "}
        <Link href="/login" className="font-semibold text-brand-600">
          Log in
        </Link>
      </p>
    </main>
  );
}
