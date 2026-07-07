"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push(data.onboarded ? "/home" : "/onboarding");
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
      <h1 className="mt-6 text-3xl font-extrabold">Welcome back</h1>
      <p className="mt-2 text-neutral-500">
        Demo account: <code className="rounded bg-neutral-100 px-1">demo@mixer.app</code> /{" "}
        <code className="rounded bg-neutral-100 px-1">password123</code>
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-brand-600">
          Create an account
        </Link>
      </p>
    </main>
  );
}
