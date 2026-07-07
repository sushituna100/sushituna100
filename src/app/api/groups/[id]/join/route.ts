import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const group = await prisma.friendGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (!group.open) {
    return NextResponse.json({ error: "This group isn't accepting new members" }, { status: 400 });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId: user.id, groupId: params.id } },
  });
  if (membership) {
    return NextResponse.json({ error: "You're already in this group" }, { status: 409 });
  }

  const { message } = await req.json();
  await prisma.groupJoinRequest.upsert({
    where: { userId_groupId: { userId: user.id, groupId: params.id } },
    create: {
      userId: user.id,
      groupId: params.id,
      message: typeof message === "string" ? message.trim().slice(0, 300) : "",
    },
    update: {
      status: "pending",
      message: typeof message === "string" ? message.trim().slice(0, 300) : "",
    },
  });

  return NextResponse.json({ ok: true });
}
