import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, isAuthed, json } from "@/lib/api";
import { EventsInput } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return fail(401, "unauthorized");
  const parsed = EventsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "bad events");
  const errors: string[] = [];
  for (const e of parsed.data.events) {
    const { error } = await db().rpc("apply_event", { p_id: e.id, p_kind: e.kind });
    if (error) errors.push(error.message);
  }
  if (errors.length === parsed.data.events.length) return fail(500, errors[0]);
  return json({ ok: true, applied: parsed.data.events.length - errors.length });
}
