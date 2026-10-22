import { after, type NextRequest } from "next/server";
import { ensureQuestions } from "@/lib/recall";
import { db } from "@/lib/db";
import { fail, getUser, json } from "@/lib/api";
import { EventsInput } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const parsed = EventsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "bad events");
  const errors: string[] = [];
  for (const e of parsed.data.events) {
    const { error } = await db().rpc("apply_event", { p_user: user.id, p_id: e.id, p_kind: e.kind });
    if (error) errors.push(error.message);
  }
  if (errors.length === parsed.data.events.length) return fail(500, errors[0]);
  // Saved/liked ideas get a recall question, written once, in the background.
  const kept = parsed.data.events.filter((e) => e.kind === "save" || e.kind === "like").map((e) => e.id);
  if (kept.length) after(() => ensureQuestions(kept).catch(() => 0));
  return json({ ok: true, applied: parsed.data.events.length - errors.length });
}
