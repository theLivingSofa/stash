import "server-only";
import type { NextResponse } from "next/server";
import { createSessionToken, PENDING_COOKIE, SESSION_COOKIE, SESSION_DAYS, UID_COOKIE, type SessionUser } from "./session";

const secure = () => process.env.NODE_ENV === "production";

export async function setSessionCookies(res: NextResponse, user: SessionUser) {
  const maxAge = SESSION_DAYS * 86_400;
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge });
  // Not secret: lets the client keep offline caches separate per person.
  res.cookies.set(UID_COOKIE, user.id, { httpOnly: false, secure: secure(), sameSite: "lax", path: "/", maxAge });
  res.cookies.set(PENDING_COOKIE, "", { path: "/", maxAge: 0 });
}

export function clearSessionCookies(res: NextResponse) {
  for (const name of [SESSION_COOKIE, UID_COOKIE, PENDING_COOKIE]) res.cookies.set(name, "", { path: "/", maxAge: 0 });
}
