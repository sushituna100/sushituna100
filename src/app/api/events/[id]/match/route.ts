import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { matchEvent } from "@/lib/matching";

// Runs the matching algorithm for an event. In production this would be a
// scheduled job that fires when booking closes; here any confirmed guest can
// trigger it from the event page for demo purposes.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const reservation = await prisma.reservation.findUnique({
    where: { userId_eventId: { userId: user.id, eventId: params.id } },
  });
  if (!reservation || reservation.status === "pending_payment") {
    return NextResponse.json({ error: "Only confirmed guests can run matching" }, { status: 403 });
  }

  try {
    const result = await matchEvent(params.id);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Matching failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
