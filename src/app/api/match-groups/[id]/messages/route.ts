import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function assertMember(userId: string, matchGroupId: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { matchGroupId, userId },
  });
  return Boolean(reservation);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await assertMember(user.id, params.id))) {
    return NextResponse.json({ error: "Not in this group" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { matchGroupId: params.id },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, avatarEmoji: true, avatarColor: true } },
    },
  });
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await assertMember(user.id, params.id))) {
    return NextResponse.json({ error: "Not in this group" }, { status: 403 });
  }

  const { body } = await req.json();
  const text = typeof body === "string" ? body.trim().slice(0, 500) : "";
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });

  await prisma.message.create({
    data: { senderId: user.id, matchGroupId: params.id, body: text },
  });
  return NextResponse.json({ ok: true });
}
