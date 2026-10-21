import { db, must } from "@/lib/db";
import { fail, isAuthed, json } from "@/lib/api";
import { TOPICS } from "@/lib/topics";

export async function GET() {
  if (!(await isAuthed())) return fail(401, "unauthorized");
  const stats = must(await db().rpc("buffer_stats"), "buffer_stats") as { by_topic: { topic: string; total: number; unseen: number }[] };
  const by = new Map(stats.by_topic.map((t) => [t.topic, t]));
  return json({
    topics: TOPICS.map((t) => ({ ...t, total: by.get(t.slug)?.total ?? 0, unseen: by.get(t.slug)?.unseen ?? 0 })),
  });
}
