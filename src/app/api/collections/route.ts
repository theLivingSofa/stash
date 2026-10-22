import type { NextRequest } from "next/server";
import { db, must } from "@/lib/db";
import { fail, getUser, json } from "@/lib/api";
import { CollectionInput } from "@/lib/schemas";

export async function GET() {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const rows = must(
    await db()
      .from("collections")
      .select("id, name, created_at, collection_items(count)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    "collections",
  ) as { id: string; name: string; created_at: string; collection_items: { count: number }[] }[];
  return json({
    collections: rows.map((r) => ({ id: r.id, name: r.name, count: r.collection_items?.[0]?.count ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const parsed = CollectionInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Give the collection a name (up to 60 characters).");
  const { data, error } = await db().from("collections").insert({ name: parsed.data.name, user_id: user.id }).select("id, name").single();
  if (error) return fail(/duplicate|unique/i.test(error.message) ? 409 : 500, /duplicate|unique/i.test(error.message) ? "You already have a collection with that name." : error.message);
  return json({ collection: { ...data, count: 0 } });
}
