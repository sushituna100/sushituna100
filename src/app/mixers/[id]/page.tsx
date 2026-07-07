import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/payments";
import { parseJsonArray } from "@/lib/quiz";
import Avatar from "@/components/Avatar";
import BottomNav from "@/components/BottomNav";
import Chat from "@/components/Chat";
import MatchRunner from "@/components/MatchRunner";
import ReserveButton from "@/components/ReserveButton";
import VotePanel from "@/components/VotePanel";
import { formatEventDate, formatEventTime } from "@/components/EventCard";

export const dynamic = "force-dynamic";

export default async function MixerPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboarded) redirect("/onboarding");

  const event = await prisma.mixerEvent.findUnique({
    where: { id: params.id },
    include: { reservations: { where: { status: { not: "pending_payment" } } } },
  });
  if (!event) notFound();

  const reservation = await prisma.reservation.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: event.id } },
    include: {
      matchGroup: {
        include: {
          reservations: { include: { user: true } },
          votes: true,
        },
      },
    },
  });

  const confirmedCount = event.reservations.length;
  const matchGroup = reservation?.matchGroup ?? null;
  const tablemates = matchGroup
    ? matchGroup.reservations.map((r) => r.user).filter((u) => u.id !== user.id)
    : [];
  const myVote = matchGroup
    ? (matchGroup.votes.find((v) => v.userId === user.id)?.keepGoing ?? null)
    : null;
  const yesVotes = matchGroup ? matchGroup.votes.filter((v) => v.keepGoing).length : 0;

  return (
    <main className="px-5 py-8">
      <Link href="/home" className="text-sm font-semibold text-brand-600">
        ‹ All mixers
      </Link>

      <div className="mt-4 text-center">
        <span className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-50 text-5xl">
          {event.emoji}
        </span>
        <h1 className="mt-3 text-2xl font-extrabold">{event.title}</h1>
        <p className="mt-1 text-neutral-500">
          {formatEventDate(event.startsAt)} at {formatEventTime(event.startsAt)}
        </p>
        <p className="text-neutral-500">
          {event.venue} · {event.city}
        </p>
        <p className="mt-2 text-sm text-neutral-400">
          {confirmedCount} {confirmedCount === 1 ? "person" : "people"} going · groups of{" "}
          {event.capacityPerGroup} · {formatPrice(event.priceCents)}
        </p>
      </div>

      <p className="card mt-6 text-sm leading-relaxed text-neutral-600">{event.description}</p>

      <div className="mt-6 space-y-4">
        {!reservation && !event.matched && event.startsAt >= new Date() && (
          <ReserveButton eventId={event.id} price={formatPrice(event.priceCents)} />
        )}
        {!reservation && (event.matched || event.startsAt < new Date()) && (
          <p className="card text-center text-sm text-neutral-500">
            Booking for this mixer has closed.
          </p>
        )}

        {reservation?.status === "pending_payment" && (
          <Link href={`/checkout/${reservation.id}`} className="btn-primary">
            Finish payment to lock your seat · {formatPrice(event.priceCents)}
          </Link>
        )}

        {reservation && reservation.status !== "pending_payment" && !matchGroup && (
          <>
            <div className="card border-emerald-200 bg-emerald-50 text-center">
              <p className="text-3xl">🎟️</p>
              <h3 className="mt-1 font-bold text-emerald-800">Your seat is confirmed</h3>
              <p className="mt-1 text-sm text-emerald-700">
                We'll reveal your table of {event.capacityPerGroup} on the day of the mixer.
              </p>
            </div>
            {!event.matched && <MatchRunner eventId={event.id} />}
          </>
        )}

        {matchGroup && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
                🎊 Your table — {matchGroup.name}
              </h2>
              <div className="space-y-3">
                {tablemates.map((mate) => (
                  <div key={mate.id} className="card flex items-center gap-3">
                    <Avatar emoji={mate.avatarEmoji} color={mate.avatarColor} size={44} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">
                        {mate.name}
                        <span className="ml-2 text-sm font-normal text-neutral-400">
                          {mate.age}
                        </span>
                      </h3>
                      <p className="truncate text-sm text-neutral-500">
                        {parseJsonArray<string>(mate.interests).slice(0, 3).join(" · ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
                Table chat
              </h2>
              <Chat
                endpoint={`/api/match-groups/${matchGroup.id}/messages`}
                currentUserId={user.id}
              />
            </section>

            <VotePanel
              matchGroupId={matchGroup.id}
              myVote={myVote}
              yesVotes={yesVotes}
              memberCount={matchGroup.reservations.length}
              friendGroupId={matchGroup.friendGroupId}
            />
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
