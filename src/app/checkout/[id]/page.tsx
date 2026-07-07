import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/payments";
import PaymentForm from "@/components/PaymentForm";
import { formatEventDate, formatEventTime } from "@/components/EventCard";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const reservation = await prisma.reservation.findUnique({
    where: { id: params.id },
    include: { event: true },
  });
  if (!reservation || reservation.userId !== user.id) notFound();
  if (reservation.status !== "pending_payment") redirect(`/mixers/${reservation.eventId}`);

  const { event } = reservation;

  return (
    <main className="px-5 py-8">
      <Link href={`/mixers/${event.id}`} className="text-sm font-semibold text-brand-600">
        ‹ Back to mixer
      </Link>

      <h1 className="mt-6 text-2xl font-extrabold">Lock in your seat</h1>
      <p className="mt-1 text-sm text-neutral-500">
        A small fee keeps everyone committed — no-shows ruin the table for everyone else.
      </p>

      <div className="card mt-6 flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl">
          {event.emoji}
        </span>
        <div className="flex-1">
          <h3 className="font-semibold">{event.title}</h3>
          <p className="text-sm text-neutral-500">
            {formatEventDate(event.startsAt)} at {formatEventTime(event.startsAt)}
          </p>
        </div>
        <p className="text-lg font-bold text-brand-600">{formatPrice(event.priceCents)}</p>
      </div>

      <div className="mt-6">
        <PaymentForm
          reservationId={reservation.id}
          eventId={event.id}
          price={formatPrice(event.priceCents)}
        />
      </div>
    </main>
  );
}
