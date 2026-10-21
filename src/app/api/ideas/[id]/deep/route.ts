import { z } from "zod";
import { fail, isAuthed, json } from "@/lib/api";
import { ensureBack } from "@/lib/ingest/deep";

export const maxDuration = 60;

/** Fallback: generate (and cache) the BACK for an idea that is missing one. */
export async function POST(_req: Request, ctx: RouteContext<"/api/ideas/[id]/deep">) {
  if (!(await isAuthed())) return fail(401, "unauthorized");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(400, "bad id");
  try {
    const r = await ensureBack(id);
    return json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not found") return fail(404, msg);
    return fail(503, "Couldn't write the deep dive right now. Try again in a minute.");
  }
}
