import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type SessionUser } from "./auth/session";
import { userAccess } from "./auth/users";

export const noStore = { "Cache-Control": "private, no-store" };

export function json<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...noStore, ...(init.headers ?? {}) } });
}

export function fail(status: number, message: string) {
  return json({ error: message }, { status });
}

/**
 * The signed-in user, or null. The proxy already gates routes; this re-checks
 * the session and that the user is still allowed in (owner, or still on the list).
 */
export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const access = await userAccess(session.id);
  if (!access || !access.allowed) return null;
  return { ...session, role: access.role, email: access.email ?? session.email };
}

export async function requireOwner(): Promise<SessionUser | null> {
  const user = await getUser();
  return user?.role === "owner" ? user : null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}
