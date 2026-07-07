import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.onboarded) {
    return NextResponse.json({ error: "Finish onboarding before booking" }, { status: 403 });
  }

  const { eventId } = await req.json();
  const event = await prisma.mixerEvent.findUnique({ where: { id: eventId } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  if (event.matched || event.startsAt < new Date()) {
    return NextResponse.json({ error: "This mixer is no longer open for booking" }, { status: 400 });
  }

  const existing = await prisma.reservation.findUnique({
    where: { userId_eventId: { userId: user.id, eventId } },
  });
  if (existing) {
    if (existing.status === "pending_payment") {
      return NextResponse.json({ reservationId: existing.id });
    }
    return NextResponse.json({ error: "You already have a spot at this mixer" }, { status: 409 });
  }

  const reservation = await prisma.reservation.create({
    data: { userId: user.id, eventId },
  });
  return NextResponse.json({ reservationId: reservation.id });
}
