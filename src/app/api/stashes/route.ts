import type { NextRequest } from "next/server";
import { z } from "zod";
import { db, must } from "@/lib/db";
import { fail, isAuthed, json } from "@/lib/api";
import { toCard, type CardRow } from "@/lib/feed/chain";

const Query = z.object({
  q: z.string().trim().max(120).optional(),
  collection: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  kind: z.enum(["all", "saved", "liked"]).default("all"),
});

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return fail(401, "unauthorized");
  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return fail(400, "bad query");
  const limit = 30;
  const rows = must(
    await db().rpc("search_saved", {
      p_q: q.data.q ?? null,
      p_collection: q.data.collection ?? null,
      p_limit: limit,
      p_offset: q.data.offset,
      p_kind: q.data.kind,
    }),
    "search_saved",
  ) as CardRow[];
  return json({ cards: rows.map((r) => toCard(r, "remember")), nextOffset: rows.length === limit ? q.data.offset + limit : null });
}
