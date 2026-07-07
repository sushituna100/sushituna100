import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

const SECRET = process.env.SESSION_SECRET ?? "mixer-dev-secret-change-in-production";
const COOKIE_NAME = "mixer_session";

function sign(userId: string): string {
  const mac = createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${mac}`;
}

function verify(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", SECRET).update(userId).digest("hex");
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return userId;
}

export function createSession(userId: string) {
  cookies().set(COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function destroySession() {
  cookies().delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = verify(token);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
