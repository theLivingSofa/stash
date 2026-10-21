import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./auth/session";

export const noStore = { "Cache-Control": "private, no-store" };

export function json<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...noStore, ...(init.headers ?? {}) } });
}

export function fail(status: number, message: string) {
  return json({ error: message }, { status });
}

/** Defence in depth: the proxy already gates routes, but every handler re-checks. */
export async function isAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}
