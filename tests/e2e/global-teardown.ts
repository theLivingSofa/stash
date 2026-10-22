import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_FILE = join(tmpdir(), "stash-e2e-user.json");

export default async function globalTeardown() {
  loadEnv({ path: ".env.local", quiet: true });
  const file = STATE_FILE;
  if (!existsSync(file)) return;
  const { id, email } = JSON.parse(readFileSync(file, "utf8"));
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  await sb.from("allowed_emails").delete().eq("email", email);
  await sb.from("users").delete().eq("id", id);
  rmSync(file);
}
