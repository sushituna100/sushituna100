import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { INTEREST_TAGS, QUIZ_QUESTIONS } from "@/lib/quiz";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { personality, interests, bio } = await req.json();

  if (
    !Array.isArray(personality) ||
    personality.length !== QUIZ_QUESTIONS.length ||
    personality.some((v) => typeof v !== "number" || v < 1 || v > 5)
  ) {
    return NextResponse.json({ error: "Please answer every question" }, { status: 400 });
  }
  if (
    !Array.isArray(interests) ||
    interests.length < 3 ||
    interests.some((t) => !INTEREST_TAGS.includes(t))
  ) {
    return NextResponse.json({ error: "Pick at least 3 interests" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      personality: JSON.stringify(personality),
      interests: JSON.stringify(interests),
      bio: typeof bio === "string" ? bio.slice(0, 200) : user.bio,
      onboarded: true,
    },
  });

  return NextResponse.json({ ok: true });
}
