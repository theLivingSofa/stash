import "server-only";
import { db, must } from "../db";
import { audioReady } from "../tts/backfill";
import { dueRecall, pickTrivia } from "../recall";
import type { CardRow, FeedFilter, FeedRepo, RecallRow, Tier } from "./chain";

const INTEREST_BOOST = 3;

export class DbFeedRepo implements FeedRepo {
  constructor(private userId: string) {}

  async candidates(sessionId: string, tier: Tier, filter: FeedFilter, limit: number): Promise<CardRow[]> {
    const rows = (must(
      await db().rpc("feed_candidates", {
        p_user: this.userId,
        p_session: sessionId,
        p_tier: tier,
        p_topic: filter.topic ?? null,
        p_concept: filter.concept ?? null,
        p_limit: limit,
        p_embedding: filter.concept && filter.embedding ? JSON.stringify(filter.embedding) : null,
      }),
      `feed_candidates(${tier})`,
    ) ?? []) as CardRow[];
    const ready = await audioReady(rows.map((r) => r.id));
    for (const r of rows) r.audio = ready.has(r.id);
    return rows;
  }

  async dueRecall(sessionId: string, limit: number): Promise<RecallRow[]> {
    const due = await dueRecall(this.userId, sessionId, limit).catch(() => []);
    if (due.length === 0) return [];
    const rows = await getCards(this.userId, due.map((d) => d.idea_id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return due.flatMap((d) => {
      const row = byId.get(d.idea_id);
      return row ? [{ row, box: d.box, question: d.question }] : [];
    });
  }

  async trivia(sessionId: string): Promise<RecallRow | null> {
    const t = await pickTrivia(this.userId, sessionId).catch(() => null);
    if (!t) return null;
    const [row] = await getCards(this.userId, [t.idea_id]);
    return row ? { row, box: 0, question: t.question } : null;
  }

  async affinity(): Promise<Map<string, number>> {
    const [{ data: rows, error }, { data: me }] = await Promise.all([
      db().rpc("topic_affinity", { p_user: this.userId, p_half_life_days: 14 }),
      db().from("users").select("interests").eq("id", this.userId).maybeSingle(),
    ]);
    if (error) throw new Error(`topic_affinity: ${error.message}`);
    const map = new Map(((rows ?? []) as { topic: string; score: number }[]).map((r) => [r.topic, Number(r.score)]));
    // Topics picked on first sign-in: a head start, worth about one save each,
    // that real reading signals soon outweigh.
    for (const t of ((me?.interests as string[] | null) ?? [])) map.set(t, (map.get(t) ?? 0) + INTEREST_BOOST);
    return map;
  }

  async serve(sessionId: string, ids: string[], rememberedIds: string[]) {
    must(await db().rpc("serve_ideas", { p_user: this.userId, p_session: sessionId, p_ids: ids, p_remembered: rememberedIds }), "serve_ideas");
  }

  async resetSession(sessionId: string) {
    must(await db().rpc("reset_session", { p_session: sessionId }), "reset_session");
  }

  async unseenCount(): Promise<number> {
    return must(await db().rpc("unseen_count", { p_user: this.userId }), "unseen_count") as number;
  }
}

export async function getCards(userId: string, ids: string[]): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  return (must(await db().rpc("get_cards", { p_user: userId, p_ids: ids }), "get_cards") ?? []) as CardRow[];
}
