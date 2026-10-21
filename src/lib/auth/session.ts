import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "stash_session";
export const SESSION_DAYS = 90;

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Changes whenever APP_PASSCODE changes, so rotating the passcode logs out old sessions. */
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

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ pv: await passcodeVersion() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub === "owner" && payload.pv === (await passcodeVersion());
  } catch {
    return false;
  }
}

/** Opaque, signed feed cursor. */
export interface CursorData {
  s: string; // feed session id
  p: number; // page number
  t?: string; // topic filter
  c?: string; // concept filter
}

export async function signCursor(data: CursorData): Promise<string> {
  return new SignJWT({ ...data }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("3d").sign(secretKey());
}

export async function readCursor(token: string): Promise<CursorData | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.s !== "string" || typeof payload.p !== "number") return null;
    return { s: payload.s, p: payload.p, t: payload.t as string | undefined, c: payload.c as string | undefined };
  } catch {
    return null;
  }
}
