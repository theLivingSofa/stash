import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkPasscode, createSessionToken, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth/session";
import { LoginInput } from "@/lib/schemas";
import { clientIp, fail } from "@/lib/api";

const MAX_ATTEMPTS = 5;
const WINDOW_MIN = 15;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const { count } = await db().from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if ((count ?? 0) >= MAX_ATTEMPTS) {
    return fail(429, `Too many attempts. Try again in ${WINDOW_MIN} minutes.`);
  }

  const parsed = LoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await checkPasscode(parsed.data.passcode))) {
    await db().from("login_attempts").insert({ ip });
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return fail(401, "That passcode didn't work.");
  }

  await db().from("login_attempts").delete().eq("ip", ip);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
