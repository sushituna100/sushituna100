import { prisma } from "./db";
import { parseJsonArray } from "./quiz";

type Candidate = {
  reservationId: string;
  userId: string;
  age: number;
  personality: number[];
  interests: string[];
};

// Compatibility score between two people: lower is better.
// Combines personality distance, interest overlap and age gap.
export function pairScore(a: Candidate, b: Candidate): number {
  let personalityDist = 0;
  const dims = Math.max(a.personality.length, b.personality.length, 1);
  for (let i = 0; i < dims; i++) {
    const d = (a.personality[i] ?? 3) - (b.personality[i] ?? 3);
    personalityDist += d * d;
  }
  personalityDist = Math.sqrt(personalityDist) / Math.sqrt(dims * 16); // 0..1

  const shared = a.interests.filter((t) => b.interests.includes(t)).length;
  const union = new Set([...a.interests, ...b.interests]).size || 1;
  const interestDist = 1 - shared / union; // 0..1

  const ageDist = Math.min(Math.abs(a.age - b.age) / 15, 1); // 0..1

  return personalityDist * 0.45 + interestDist * 0.35 + ageDist * 0.2;
}

// Greedy grouping: repeatedly seed a group with an unassigned person and
// fill it with their most compatible remaining candidates.
export function buildGroups(candidates: Candidate[], capacity: number): Candidate[][] {
  const pool = [...candidates];
  const groups: Candidate[][] = [];
  while (pool.length > 0) {
    const seed = pool.shift()!;
    const group = [seed];
    while (group.length < capacity && pool.length > 0) {
      let bestIdx = 0;
      let bestScore = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const score =
          group.reduce((sum, member) => sum + pairScore(member, pool[i]), 0) / group.length;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      group.push(pool.splice(bestIdx, 1)[0]);
    }
    groups.push(group);
  }
  // Avoid a lonely table: fold a single leftover into the previous group.
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    groups[groups.length - 2].push(groups.pop()![0]);
  }
  return groups;
}

export async function matchEvent(eventId: string) {
  const event = await prisma.mixerEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.matched) return { alreadyMatched: true, groups: 0 };

  const reservations = await prisma.reservation.findMany({
    where: { eventId, status: "confirmed" },
    include: { user: true },
  });
  if (reservations.length < 2) throw new Error("Need at least 2 confirmed guests to match");

  const candidates: Candidate[] = reservations.map((r) => ({
    reservationId: r.id,
    userId: r.userId,
    age: r.user.age,
    personality: parseJsonArray<number>(r.user.personality),
    interests: parseJsonArray<string>(r.user.interests),
  }));

  const groups = buildGroups(candidates, event.capacityPerGroup);

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < groups.length; i++) {
      const mg = await tx.matchGroup.create({
        data: { eventId, name: `Table ${i + 1}` },
      });
      await tx.reservation.updateMany({
        where: { id: { in: groups[i].map((c) => c.reservationId) } },
        data: { matchGroupId: mg.id },
      });
    }
    await tx.mixerEvent.update({ where: { id: eventId }, data: { matched: true } });
  });

  return { alreadyMatched: false, groups: groups.length };
}
