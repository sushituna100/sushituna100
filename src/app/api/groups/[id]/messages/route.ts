import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function isMember(userId: string, groupId: string) {
  const membership = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId, groupId } },
  });
  return Boolean(membership);
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!(await isMember(user.id, params.id))) {
    return NextResponse.json({ error: "Members only" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { friendGroupId: params.id },
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
  if (!(await isMember(user.id, params.id))) {
    return NextResponse.json({ error: "Members only" }, { status: 403 });
  }

  const { body } = await req.json();
  const text = typeof body === "string" ? body.trim().slice(0, 500) : "";
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });

  await prisma.message.create({
    data: { senderId: user.id, friendGroupId: params.id, body: text },
  });
  return NextResponse.json({ ok: true });
}
