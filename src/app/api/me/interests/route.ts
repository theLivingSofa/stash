import { z } from "zod";
import { db, must } from "@/lib/db";
import { fail, getUser, json } from "@/lib/api";
import { isTopic } from "@/lib/topics";

const Body = z.object({ topics: z.array(z.string()).max(16) });

/** POST { topics }: the reader's chosen topics (empty = skipped). Marks them as onboarded. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return fail(400, "bad request");
  const topics = [...new Set(b.data.topics.filter(isTopic))];
  must(await db().from("users").update({ interests: topics, onboarded_at: new Date().toISOString() }).eq("id", user.id), "save interests");
  return json({ topics });
}
