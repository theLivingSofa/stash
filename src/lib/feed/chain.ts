import type { Card, CardKind, IdeaBack } from "../types";
import { rankIdeas } from "./rank";

export const PAGE_SIZE = 20;
export const BUFFER_TARGET = 500;
const CANDIDATE_POOL = 300;

export type Tier = "unseen" | "seen" | "saved" | "any";

export interface FeedFilter {
  topic?: string | null;
  concept?: string | null;
  /** Embedding of `concept`, for meaning-based matches (null = keywords only). */
  embedding?: number[] | null;
}

/** Row shape returned by the feed_candidates / get_cards SQL functions. */
export interface CardRow {
  id: string;
  title: string | null;
  text: string;
  topics: string[];
  why_it_matters: string | null;
  main_concept: string | null;
  back: IdeaBack | null;
  learn_more_url: string | null;
  source_title: string;
  source_author: string | null;
  source_url: string;
  source_domain: string;
  created_at: string;
  seen_at: string | null;
  saved_at: string | null;
  reaction: number | null;
  /** Read-aloud audio ready (set by the repo, not the SQL row). */
  audio?: boolean;
}

export interface FeedRepo {
  candidates(sessionId: string, tier: Tier, filter: FeedFilter, limit: number): Promise<CardRow[]>;
  affinity(): Promise<Map<string, number>>;
  serve(sessionId: string, ids: string[], rememberedIds: string[]): Promise<void>;
  resetSession(sessionId: string): Promise<void>;
  unseenCount(): Promise<number>;
}

export interface PageResult {
  cards: Card[];
  /** The unseen buffer is low: kick off a background ingest. */
  needIngest: boolean;
  /** The filter ran out of unseen ideas: worth a focused ingest for it. */
  needFocus: boolean;
  widenedFrom?: string;
}

export function toCard(r: CardRow, kind: CardKind): Card {
  return {
    id: r.id,
    title: r.title,
    text: r.text,
    topics: r.topics ?? [],
    why: r.why_it_matters,
    concept: r.main_concept,
    back: r.back,
    learnMoreUrl: r.learn_more_url,
    source: { title: r.source_title, author: r.source_author, url: r.source_url, domain: r.source_domain },
    createdAt: r.created_at,
    kind,
    saved: !!r.saved_at,
    reaction: (r.reaction ?? 0) > 0 ? 1 : (r.reaction ?? 0) < 0 ? -1 : 0,
  };
}

export function filterLabel(f: FeedFilter): string | undefined {
  // (the embedding is an implementation detail, never a label)
  return f.concept ?? f.topic ?? undefined;
}

const hasFilter = (f: FeedFilter) => !!(f.topic || f.concept);

/**
 * Build one feed page. The feed never repeats an idea the reader has seen
 * (seen = on screen for 1.5s); saved and liked ideas live in the Library.
 *
 *   1. unseen ideas matching the filter, ranked (affinity + freshness + ~20% exploration)
 *   2. filtered feeds that run dry widen to all unseen ideas, marked "beyond"
 *   3. ideas dealt earlier in THIS session are skipped; ideas dealt in an
 *      earlier session but never seen are eligible again (nothing is wasted)
 *
 * Endlessness comes from the buffer: whenever fewer than BUFFER_TARGET unseen
 * ideas remain, `needIngest` asks the caller to generate more in the
 * background. An empty page only happens if every unseen idea is used up; the
 * caller then ingests synchronously and the client shows "finding new ideas".
 */
export async function buildPage(
  repo: FeedRepo,
  opts: { sessionId: string; filter: FeedFilter; size?: number; rng?: () => number; now?: number },
): Promise<PageResult> {
  const size = opts.size ?? PAGE_SIZE;
  const rng = opts.rng ?? Math.random;
  const cards: Card[] = [];
  const taken = new Set<string>();

  const [unseenTotal, affinity] = await Promise.all([repo.unseenCount(), repo.affinity()]);
  const needIngest = unseenTotal < BUFFER_TARGET;
  let needFocus = false;
  let widenedFrom: string | undefined;

  const fill = async (filter: FeedFilter) => {
    const unseen = (await repo.candidates(opts.sessionId, "unseen", filter, CANDIDATE_POOL)).filter((r) => !taken.has(r.id));
    if (hasFilter(filter) && unseen.length < size) needFocus = true;
    // Concept searches come back best-match first; keep that order. Everything
    // else gets the personal ranking (affinity, freshness, exploration).
    const ranked = filter.concept
      ? unseen.slice(0, size - cards.length)
      : rankIdeas(
          unseen.map((u) => ({ ...u, createdAt: u.created_at })),
          affinity,
          { n: size - cards.length, rng, now: opts.now },
        );
    for (const r of ranked) {
      if (cards.length >= size) break;
      taken.add(r.id);
      cards.push(toCard(r, "new"));
    }
  };

  await fill(opts.filter);

  if (cards.length < size && hasFilter(opts.filter)) {
    const before = cards.length;
    await fill({});
    if (cards.length > before) {
      widenedFrom = filterLabel(opts.filter);
      cards[before].beyond = widenedFrom;
    }
  }

  if (cards.length > 0) await repo.serve(opts.sessionId, cards.map((c) => c.id), []);
  return { cards, needIngest: needIngest || cards.length < size, needFocus, widenedFrom };
}
