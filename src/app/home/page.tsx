import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BottomNav from "@/components/BottomNav";
import EventCard, { formatEventDate } from "@/components/EventCard";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const [myReservations, upcoming] = await Promise.all([
    prisma.reservation.findMany({
      where: { userId: user.id },
      include: { event: true },
      orderBy: { event: { startsAt: "desc" } },
    }),
    prisma.mixerEvent.findMany({
      where: { startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const reservedIds = new Set(myReservations.map((r) => r.eventId));
  const available = upcoming.filter((e) => !reservedIds.has(e.id));
  const mine = myReservations.filter(
    (r) => r.status !== "pending_payment" || r.event.startsAt >= new Date()
  );

  return (
    <main className="px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">Hey {user.name} 👋</h1>
          <p className="text-sm text-neutral-500">Mixers near {user.city}</p>
        </div>
        <Link href="/profile">
          <Avatar emoji={user.avatarEmoji} color={user.avatarColor} size={44} />
        </Link>
      </div>

      {mine.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
            Your mixers
          </h2>
          <div className="space-y-3">
            {mine.map((r) => (
              <Link
                key={r.id}
                href={r.status === "pending_payment" ? `/checkout/${r.id}` : `/mixers/${r.eventId}`}
                className="card flex items-center gap-4 transition hover:border-brand-200 hover:shadow-md"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
                  {r.event.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{r.event.title}</h3>
                  <p className="text-sm text-neutral-500">
                    {formatEventDate(r.event.startsAt)} · {r.event.venue}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    r.status === "pending_payment"
                      ? "bg-amber-100 text-amber-700"
                      : r.matchGroupId
                        ? "bg-brand-100 text-brand-700"
                        : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {r.status === "pending_payment"
                    ? "Pay to confirm"
                    : r.matchGroupId
                      ? "Matched!"
                      : "Confirmed"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
          Upcoming mixers
        </h2>
        {available.length === 0 ? (
          <p className="card text-center text-sm text-neutral-500">
            You're booked into everything coming up — look at you go! 🎉
          </p>
        ) : (
          <div className="space-y-3">
            {available.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
