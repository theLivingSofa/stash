import { config as loadEnv } from "dotenv";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_FILE = join(tmpdir(), "stash-e2e-user.json");
import { createSessionToken } from "../../src/lib/auth/session";

/**
 * E2E runs as a throwaway member account, never the owner, so tests don't touch
 * real reading history. global-teardown deletes it.
 */
export default async function globalSetup() {
  loadEnv({ path: ".env.local", quiet: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const email = `e2e-${Date.now()}@example.invalid`;
  const { data, error } = await sb.from("users").insert({ email, name: "E2E test reader", role: "member" }).select("id").single();
  if (error) throw error;
  await sb.from("allowed_emails").insert({ email });
  const token = await createSessionToken({ id: data.id, email, role: "member", via: "google" });
  writeFileSync(STATE_FILE, JSON.stringify({ id: data.id, email, token }));
  process.env.E2E_SESSION = token;
  process.env.E2E_UID = data.id;
}
