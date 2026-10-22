import { after } from "next/server";
import { fail, getUser, json } from "@/lib/api";
import { runIngest } from "@/lib/ingest/run";

export const maxDuration = 60;

/** Manual "refresh now": fetch fresh ideas in the background. */
export async function POST() {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  after(() => runIngest({ trigger: "manual", budgetMs: 50_000, force: true }).catch((e) => console.error("[refresh]", e)));
  return json({ ok: true, message: "Fetching fresh ideas. New cards will appear within a minute or two." });
}
