import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_FILE = join(tmpdir(), "stash-e2e-user.json");

export default async function globalTeardown() {
  loadEnv({ path: ".env.local", quiet: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const file = STATE_FILE;
  if (existsSync(file)) {
    const { id, email } = JSON.parse(readFileSync(file, "utf8"));
    await sb.from("allowed_emails").delete().eq("email", email);
    await sb.from("users").delete().eq("id", id);
    rmSync(file);
  }
  // Sweep test readers left behind by an interrupted or overlapping run.
  const stale = new Date(Date.now() - 3_600_000).toISOString();
  await sb.from("allowed_emails").delete().like("email", "e2e-%@example.invalid").lt("added_at", stale);
  await sb.from("users").delete().like("email", "e2e-%@example.invalid").lt("created_at", stale);
}
