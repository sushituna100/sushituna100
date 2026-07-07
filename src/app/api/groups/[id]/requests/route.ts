import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Any existing member can approve or decline a pending join request.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const membership = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId: user.id, groupId: params.id } },
  });
  if (!membership) return NextResponse.json({ error: "Members only" }, { status: 403 });

  const { requestId, action } = await req.json();
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const request = await prisma.groupJoinRequest.findUnique({ where: { id: requestId } });
  if (!request || request.groupId !== params.id || request.status !== "pending") {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (action === "approve") {
    await prisma.$transaction([
      prisma.groupJoinRequest.update({
        where: { id: requestId },
        data: { status: "approved" },
      }),
      prisma.groupMembership.create({
        data: { userId: request.userId, groupId: params.id },
      }),
    ]);
  } else {
    await prisma.groupJoinRequest.update({
      where: { id: requestId },
      data: { status: "declined" },
    });
  }

  return NextResponse.json({ ok: true });
}
