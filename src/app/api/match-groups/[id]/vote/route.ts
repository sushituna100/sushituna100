import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonArray } from "@/lib/quiz";

// Vote on whether this mixer table should become a lasting friend group.
// Once a majority votes yes, the friend group is created with the yes-voters
// as founding members; later yes votes add the voter to the group too.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const matchGroup = await prisma.matchGroup.findUnique({
    where: { id: params.id },
    include: {
      event: true,
      reservations: { include: { user: true } },
      votes: true,
    },
  });
  if (!matchGroup) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (!matchGroup.reservations.some((r) => r.userId === user.id)) {
    return NextResponse.json({ error: "Not in this group" }, { status: 403 });
  }

  const { keepGoing } = await req.json();
  if (typeof keepGoing !== "boolean") {
    return NextResponse.json({ error: "Vote must be yes or no" }, { status: 400 });
  }

  await prisma.groupVote.upsert({
    where: { matchGroupId_userId: { matchGroupId: params.id, userId: user.id } },
    create: { matchGroupId: params.id, userId: user.id, keepGoing },
    update: { keepGoing },
  });

  const votes = await prisma.groupVote.findMany({ where: { matchGroupId: params.id } });
  const yesVoters = votes.filter((v) => v.keepGoing).map((v) => v.userId);
  const memberCount = matchGroup.reservations.length;
  const majority = Math.ceil(memberCount / 2);

  let friendGroupId = matchGroup.friendGroupId;

  if (!friendGroupId && yesVoters.length >= Math.max(2, majority)) {
    // Group vibe = the most common interests among the founding members.
    const counts = new Map<string, number>();
    for (const r of matchGroup.reservations) {
      if (!yesVoters.includes(r.userId)) continue;
      for (const tag of parseJsonArray<string>(r.user.interests)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const topInterests = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);

    const friendGroup = await prisma.friendGroup.create({
      data: {
        name: `${matchGroup.name} · ${matchGroup.event.title}`,
        emoji: matchGroup.event.emoji,
        city: matchGroup.event.city,
        description: `Born at ${matchGroup.event.title} — we hit it off and decided to keep the party going.`,
        interests: JSON.stringify(topInterests),
        open: false,
        memberships: {
          create: yesVoters.map((userId, i) => ({
            userId,
            role: i === 0 ? "founder" : "member",
          })),
        },
      },
    });
    await prisma.matchGroup.update({
      where: { id: params.id },
      data: { friendGroupId: friendGroup.id },
    });
    friendGroupId = friendGroup.id;
  } else if (friendGroupId && keepGoing) {
    await prisma.groupMembership.upsert({
      where: { userId_groupId: { userId: user.id, groupId: friendGroupId } },
      create: { userId: user.id, groupId: friendGroupId },
      update: {},
    });
  }

  return NextResponse.json({
    ok: true,
    yesVotes: yesVoters.length,
    totalVotes: votes.length,
    memberCount,
    friendGroupId,
  });
}
