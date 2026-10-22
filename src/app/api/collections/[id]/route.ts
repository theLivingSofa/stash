import { z } from "zod";
import { db } from "@/lib/db";
import { fail, getUser, json } from "@/lib/api";
import { CollectionItemInput } from "@/lib/schemas";

/** Add or remove an idea. Adding also saves the idea. */
export async function POST(req: Request, ctx: RouteContext<"/api/collections/[id]">) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(400, "bad id");
  const parsed = CollectionItemInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "bad input");
  const { ideaId, add } = parsed.data;
  const { data: owned } = await db().from("collections").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!owned) return fail(404, "collection not found");
  if (add) {
    await db().rpc("apply_event", { p_user: user.id, p_id: ideaId, p_kind: "save" });
    const { error } = await db().from("collection_items").upsert({ collection_id: id, idea_id: ideaId });
    if (error) return fail(500, error.message);
  } else {
    await db().from("collection_items").delete().match({ collection_id: id, idea_id: ideaId });
  }
  return json({ ok: true });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/collections/[id]">) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(400, "bad id");
  await db().from("collections").delete().eq("id", id).eq("user_id", user.id);
  return json({ ok: true });
}
