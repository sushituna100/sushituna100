import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chargeCard } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { reservationId, card } = await req.json();
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { event: true },
  });
  if (!reservation || reservation.userId !== user.id) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }
  if (reservation.status !== "pending_payment") {
    return NextResponse.json({ error: "This reservation is already paid" }, { status: 400 });
  }
  if (!card) return NextResponse.json({ error: "Card details are required" }, { status: 400 });

  const result = await chargeCard({
    userId: user.id,
    reservationId: reservation.id,
    amountCents: reservation.event.priceCents,
    card: {
      number: String(card.number ?? ""),
      expMonth: String(card.expMonth ?? ""),
      expYear: String(card.expYear ?? ""),
      cvc: String(card.cvc ?? ""),
      name: String(card.name ?? ""),
    },
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 402 });
  return NextResponse.json({ ok: true, last4: result.last4 });
}
