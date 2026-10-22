import "server-only";
import { db, must } from "../db";
import { audioReady } from "../tts/backfill";
import type { CardRow, FeedFilter, FeedRepo, Tier } from "./chain";

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

  async affinity(): Promise<Map<string, number>> {
    const rows = must(await db().rpc("topic_affinity", { p_user: this.userId, p_half_life_days: 14 }), "topic_affinity") as
      | { topic: string; score: number }[]
      | null;
    return new Map((rows ?? []).map((r) => [r.topic, Number(r.score)]));
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
