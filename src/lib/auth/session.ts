import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "stash_session";
/** Non-secret cookie the client uses to keep per-user offline caches apart. */
export const UID_COOKIE = "stash_uid";
export const PENDING_COOKIE = "stash_pending";
export const OAUTH_COOKIE = "stash_oauth";
export const SESSION_DAYS = 90;

export type Role = "owner" | "member";

export interface SessionUser {
  id: string;
  email: string | null;
  role: Role;
  via: "google" | "passcode";
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Changes whenever APP_PASSCODE changes, so rotating it logs out passcode sessions. */
async function passcodeVersion(): Promise<string> {
  return hex(await digest(`${process.env.APP_PASSCODE ?? ""}|${process.env.SESSION_SECRET ?? ""}`)).slice(0, 16);
}

/** Constant-time passcode check (compares SHA-256 digests). */
export async function checkPasscode(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return false;
  const [a, b] = await Promise.all([digest(input.trim()), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const claims: Record<string, unknown> = { email: user.email, role: user.role, via: user.via };
  if (user.via === "passcode") claims.pv = await passcodeVersion();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || (payload.role !== "owner" && payload.role !== "member")) return null;
    const via = payload.via === "passcode" ? "passcode" : "google";
    if (via === "passcode" && payload.pv !== (await passcodeVersion())) return null;
    return { id: payload.sub, email: (payload.email as string | null) ?? null, role: payload.role, via };
  } catch {
    return null;
  }
}

/** Short-lived, signed values (OAuth state, a pending Google identity). */
export async function signTemp(data: Record<string, unknown>, ttl: string): Promise<string> {
  return new SignJWT(data).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(ttl).sign(secretKey());
}

export async function readTemp<T>(token: string | undefined | null): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload as T;
  } catch {
    return null;
  }
}

/** Opaque, signed feed cursor, bound to the user it was issued to. */
export interface CursorData {
  u: string; // user id
  s: string; // feed session id
  p: number; // page number
  t?: string; // topic filter
  c?: string; // concept filter
}

export async function signCursor(data: CursorData): Promise<string> {
  return new SignJWT({ ...data }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("3d").sign(secretKey());
}

export async function readCursor(token: string, userId: string): Promise<CursorData | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.s !== "string" || typeof payload.p !== "number" || payload.u !== userId) return null;
    return { u: userId, s: payload.s, p: payload.p, t: payload.t as string | undefined, c: payload.c as string | undefined };
  } catch {
    return null;
  }
}
