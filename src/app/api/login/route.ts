import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkPasscode } from "@/lib/auth/session";
import { setSessionCookies } from "@/lib/auth/cookies";
import { ownerUserId } from "@/lib/auth/users";
import { LoginInput } from "@/lib/schemas";
import { clientIp, fail } from "@/lib/api";

const MAX_ATTEMPTS = 5;
const WINDOW_MIN = 15;

/** Owner backup login with the passcode (Google sign-in is the normal way in). */
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
  await setSessionCookies(res, { id: await ownerUserId(), email: null, role: "owner", via: "passcode" });
  return res;
}
