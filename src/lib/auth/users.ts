import "server-only";
import { db, must } from "../db";
import type { GoogleIdentity } from "./google";
import type { Role, SessionUser } from "./session";

export const ownerEmail = () => (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();

export type AccessMode = "invite" | "open";

/** "invite": approved emails only (default). "open": anyone with a verified Google account. */
export async function accessMode(): Promise<AccessMode> {
  const { data } = await db().from("app_settings").select("value").eq("key", "access").maybeSingle();
  return data?.value === "open" ? "open" : "invite";
}

export async function setAccessMode(mode: AccessMode) {
  must(await db().from("app_settings").upsert({ key: "access", value: mode, updated_at: new Date().toISOString() }), "set access mode");
}

/** Decide whether a verified Google email may use Stash. */
export async function accessFor(email: string): Promise<Role | null> {
  const e = email.trim().toLowerCase();
  if (ownerEmail() && e === ownerEmail()) return "owner";
  const { data } = await db().from("allowed_emails").select("email").eq("email", e).maybeSingle();
  if (data) return "member";
  if ((await accessMode()) === "open") {
    // Open sign-up: add them to the list, so closing it again keeps them in.
    await db().from("allowed_emails").upsert({ email: e });
    return "member";
  }
  return null;
}

/** Create or update the user row for a Google identity. The owner row already exists. */
export async function upsertGoogleUser(id: GoogleIdentity, role: Role): Promise<SessionUser> {
  const fields = { google_sub: id.sub, email: id.email, name: id.name, avatar_url: id.picture, last_active_at: new Date().toISOString() };
  if (role === "owner") {
    const row = must(
      await db().from("users").update(fields).eq("role", "owner").select("id").limit(1).single(),
      "update owner",
    ) as { id: string };
    return { id: row.id, email: id.email, role: "owner", via: "google" };
  }
  const row = must(
    await db().from("users").upsert({ ...fields, role: "member" }, { onConflict: "email" }).select("id, role").single(),
    "upsert user",
  ) as { id: string; role: Role };
  return { id: row.id, email: id.email, role: row.role, via: "google" };
}

export async function ownerUserId(): Promise<string> {
  const row = must(await db().from("users").select("id").eq("role", "owner").limit(1).single(), "owner user") as { id: string };
  return row.id;
}

export interface AccessRow {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  allowed: boolean;
}

const cache = new Map<string, { row: AccessRow | null; at: number }>();

/** Is this user still allowed in? Cached for a minute per server instance. */
export async function userAccess(userId: string): Promise<AccessRow | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.row;
  const { data } = await db().rpc("user_access", { p_user: userId });
  const row = ((data as AccessRow[] | null) ?? [])[0] ?? null;
  cache.set(userId, { row, at: Date.now() });
  return row;
}

export function forgetAccess(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
