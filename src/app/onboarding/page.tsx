"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { INTEREST_TAGS, QUIZ_QUESTIONS } from "@/lib/quiz";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0..4 quiz, 5 interests
  const [answers, setAnswers] = useState<number[]>(Array(QUIZ_QUESTIONS.length).fill(3));
  const [interests, setInterests] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onQuiz = step < QUIZ_QUESTIONS.length;
  const q = QUIZ_QUESTIONS[Math.min(step, QUIZ_QUESTIONS.length - 1)];

  function toggleInterest(tag: string) {
    setInterests((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function finish() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personality: answers, interests, bio }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/home");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col px-6 py-10">
      <div className="mb-8 flex gap-1.5">
        {[...Array(QUIZ_QUESTIONS.length + 1)].map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand-500" : "bg-neutral-200"}`}
          />
        ))}
      </div>

      {onQuiz ? (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-500">
            {q.dimension}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold">{q.question}</h1>

          <div className="mt-10">
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={answers[step]}
              onChange={(e) =>
                setAnswers((prev) => {
                  const next = [...prev];
                  next[step] = Number(e.target.value);
                  return next;
                })
              }
              className="w-full accent-brand-600"
            />
            <div className="mt-3 flex justify-between gap-6 text-sm text-neutral-500">
              <span className={answers[step] <= 2 ? "font-semibold text-brand-600" : ""}>
                {q.low}
              </span>
              <span
                className={`text-right ${answers[step] >= 4 ? "font-semibold text-brand-600" : ""}`}
              >
                {q.high}
              </span>
            </div>
          </div>

          <div className="mt-auto flex gap-3 pt-10">
            {step > 0 && (
              <button className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-extrabold">What are you into?</h1>
          <p className="mt-2 text-neutral-500">
            Pick at least 3 — we use these to match you and to suggest friend groups.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {INTEREST_TAGS.map((tag) => {
              const on = interests.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleInterest(tag)}
                  className={`chip ${
                    on
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-brand-300"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          <textarea
            className="input mt-6 h-24 resize-none"
            placeholder="A one-liner about you (optional)"
            value={bio}
            maxLength={200}
            onChange={(e) => setBio(e.target.value)}
          />

          {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}

          <div className="mt-auto flex gap-3 pt-10">
            <button className="btn-secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
            <button
              className="btn-primary"
              disabled={interests.length < 3 || loading}
              onClick={finish}
            >
              {loading ? "Saving…" : `Finish (${interests.length}/3 picked)`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
