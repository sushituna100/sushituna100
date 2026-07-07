import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/payments";
import { parseJsonArray, QUIZ_QUESTIONS } from "@/lib/quiz";
import Avatar from "@/components/Avatar";
import BottomNav from "@/components/BottomNav";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const payments = await prisma.payment.findMany({
    where: { userId: user.id },
    include: { reservation: { include: { event: true } } },
    orderBy: { createdAt: "desc" },
  });

  const personality = parseJsonArray<number>(user.personality);
  const interests = parseJsonArray<string>(user.interests);

  return (
    <main className="px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <Avatar emoji={user.avatarEmoji} color={user.avatarColor} size={80} />
        <h1 className="mt-3 text-2xl font-extrabold">{user.name}</h1>
        <p className="text-sm text-neutral-500">
          {user.age} · {user.city}
        </p>
        {user.bio && <p className="mt-2 max-w-xs text-sm text-neutral-600">“{user.bio}”</p>}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Your vibe
        </h2>
        <div className="card space-y-4">
          {QUIZ_QUESTIONS.map((q, i) => {
            const value = personality[i] ?? 3;
            return (
              <div key={q.dimension}>
                <div className="flex justify-between text-xs font-medium text-neutral-500">
                  <span>{q.low}</span>
                  <span>{q.high}</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-neutral-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                    style={{ width: `${(value / 5) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Interests
        </h2>
        <div className="flex flex-wrap gap-2">
          {interests.map((tag) => (
            <span key={tag} className="chip border-brand-200 bg-brand-50 text-brand-700">
              {tag}
            </span>
          ))}
        </div>
      </section>

      {payments.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
            Payment history
          </h2>
          <div className="card divide-y divide-neutral-100 p-0">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {p.reservation.event.emoji} {p.reservation.event.title}
                  </p>
                  <p className="text-xs text-neutral-400">
                    Card ····{p.cardLast4} · {p.createdAt.toLocaleDateString("en-US")}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold">{formatPrice(p.amountCents)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8">
        <LogoutButton />
      </div>

      <BottomNav />
    </main>
  );
}
