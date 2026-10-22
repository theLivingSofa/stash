import { z } from "zod";
import { fail, getUser, json } from "@/lib/api";
import { toCard } from "@/lib/feed/chain";
import { getCards } from "@/lib/feed/repo";

export async function GET(_req: Request, ctx: RouteContext<"/api/ideas/[id]">) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail(400, "bad id");
  const [row] = await getCards(user.id, [id]);
  if (!row) return fail(404, "not found");
  return json({ card: toCard(row, row.saved_at ? "remember" : row.seen_at ? "seen" : "new") });
}
