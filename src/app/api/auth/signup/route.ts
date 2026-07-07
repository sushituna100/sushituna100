import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

const AVATARS: [string, string][] = [
  ["🦊", "#f59e0b"], ["🐥", "#10b981"], ["🐼", "#6366f1"], ["🦉", "#8b5cf6"],
  ["🐙", "#ec4899"], ["🦁", "#f97316"], ["🐧", "#0ea5e9"], ["🦄", "#a855f7"],
  ["🐸", "#22c55e"], ["🦋", "#06b6d4"], ["🐰", "#f43f5e"], ["🐬", "#2563eb"],
];

export async function POST(req: NextRequest) {
  const { email, password, name, age, city } = await req.json();

  if (!email || !password || !name || !age || !city) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  const ageNum = Number(age);
  if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 120) {
    return NextResponse.json({ error: "You must be 18 or older to join Mixer" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const [avatarEmoji, avatarColor] = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const user = await prisma.user.create({
    data: {
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      name: String(name).trim(),
      age: ageNum,
      city: String(city).trim(),
      avatarEmoji,
      avatarColor,
    },
  });

  createSession(user.id);
  return NextResponse.json({ ok: true });
}
