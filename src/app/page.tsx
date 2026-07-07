import Link from "next/link";

const STEPS = [
  {
    emoji: "📝",
    title: "Take the vibe check",
    text: "A 2-minute personality quiz plus your interests — hiking, trivia, foodie nights, whatever you're into.",
  },
  {
    emoji: "🪄",
    title: "Get matched",
    text: "Our algorithm seats you with 5 compatible strangers for a dinner or activity. Your table is revealed on the day.",
  },
  {
    emoji: "🥂",
    title: "Show up & mix",
    text: "A small reservation fee (a few dollars) holds your seat and keeps everyone committed to showing up.",
  },
  {
    emoji: "💜",
    title: "Make it official",
    text: "Hit it off? Your table votes to become a lasting friend group with its own chat, hangouts and open invites.",
  },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="bg-gradient-to-b from-brand-600 to-brand-800 px-6 pb-14 pt-16 text-center text-white">
        <p className="text-6xl">🥂</p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight">Mixer</h1>
        <p className="mx-auto mt-3 max-w-xs text-lg text-brand-100">
          Meet 5 strangers over dinner. Leave with a friend group.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link href="/signup" className="btn-primary bg-white !text-brand-700 hover:bg-brand-50">
            Get started
          </Link>
          <Link
            href="/login"
            className="btn-secondary border-brand-400 bg-transparent !text-white hover:bg-brand-700"
          >
            I already have an account
          </Link>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-6 py-10">
        <h2 className="text-center text-sm font-bold uppercase tracking-widest text-neutral-400">
          How it works
        </h2>
        {STEPS.map((step, i) => (
          <div key={step.title} className="card flex gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
              {step.emoji}
            </span>
            <div>
              <h3 className="font-semibold">
                <span className="mr-1.5 text-brand-500">{i + 1}.</span>
                {step.title}
              </h3>
              <p className="mt-1 text-sm text-neutral-500">{step.text}</p>
            </div>
          </div>
        ))}

        <div className="card border-brand-100 bg-brand-50/50 text-center">
          <p className="text-sm text-neutral-600">
            Not ready for a dinner with strangers? Browse{" "}
            <span className="font-semibold text-brand-700">open friend groups</span> already
            looking for their next member.
          </p>
        </div>
      </div>

      <p className="pb-8 text-center text-xs text-neutral-400">
        Mixer · friendship, not dating · 18+
      </p>
    </main>
  );
}
