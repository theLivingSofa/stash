/**
 * Ranking for unseen ideas. Pure and deterministic given `rng`, so it is unit-tested.
 *
 *   score = affinity(topics) + freshness + jitter
 *
 * affinity comes from interaction events with exponential decay (computed in
 * SQL: save +3, like/share +2, flip +0.5, unsave -1, dislike -3, 14-day half-life),
 * squashed with tanh so one obsession can't swamp the feed.
 * About 20% of each page is an exploration slice drawn from topics the reader
 * has shown little or no affinity for, so the feed keeps widening.
 */

export interface RankCandidate {
  id: string;
  topics: string[];
  createdAt: string;
}

export interface RankOptions {
  n: number;
  exploreRatio?: number;
  now?: number;
  rng?: () => number;
  /** Freshness half-life in days. */
  freshnessHalfLifeDays?: number;
}

export function affinityScore(topics: string[], affinity: Map<string, number>): number {
  if (topics.length === 0) return 0;
  let best = -Infinity;
  let sum = 0;
  for (const t of topics) {
    const a = affinity.get(t) ?? 0;
    sum += a;
    if (a > best) best = a;
  }
  // Primary topic dominates; others contribute a little.
  return Math.tanh((best + 0.25 * (sum - best)) / 6) * 2;
}

export function freshness(createdAt: string, now: number, halfLifeDays = 5): number {
  const ageDays = Math.max(0, (now - new Date(createdAt).getTime()) / 86_400_000);
  return 0.6 * Math.pow(0.5, ageDays / halfLifeDays);
}

/** Topics the reader has little interest signal for (candidates for exploration). */
export function exploratoryTopics(all: string[], affinity: Map<string, number>): Set<string> {
  const scored = all.map((t) => ({ t, a: affinity.get(t) ?? 0 }));
  if (scored.length === 0) return new Set();
  scored.sort((x, y) => x.a - y.a);
  const cut = Math.max(1, Math.ceil(scored.length / 2));
  return new Set(scored.slice(0, cut).filter((s) => s.a <= 0.5).map((s) => s.t));
}

export function rankIdeas<T extends RankCandidate>(
  candidates: T[],
  affinity: Map<string, number>,
  opts: RankOptions,
): T[] {
  const { n, exploreRatio = 0.2, now = Date.now(), rng = Math.random, freshnessHalfLifeDays = 5 } = opts;
  if (candidates.length === 0 || n <= 0) return [];

  const scored = candidates.map((c) => ({
    c,
    score: affinityScore(c.topics, affinity) + freshness(c.createdAt, now, freshnessHalfLifeDays) + rng() * 0.5,
  }));

  const allTopics = Array.from(new Set(candidates.flatMap((c) => c.topics)));
  const explore = exploratoryTopics(allTopics, affinity);
  const exploreSlots = Math.min(Math.round(n * exploreRatio), n);
  const explorePool = scored.filter((s) => s.c.topics.some((t) => explore.has(t)));

  const picked = new Set<string>();
  const exploration: T[] = [];
  // Random (not score-ordered) picks from under-explored topics.
  const pool = [...explorePool];
  while (exploration.length < exploreSlots && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    const [s] = pool.splice(i, 1);
    exploration.push(s.c);
    picked.add(s.c.id);
  }

  const main = scored
    .filter((s) => !picked.has(s.c.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, n - exploration.length)
    .map((s) => s.c);

  return diversify(interleave(main, exploration, rng));
}

/** Spread exploration picks through the page instead of clumping them. */
function interleave<T>(main: T[], extra: T[], rng: () => number): T[] {
  const out = [...main];
  for (const e of extra) {
    const pos = Math.min(out.length, 1 + Math.floor(rng() * Math.max(1, out.length)));
    out.splice(pos, 0, e);
  }
  return out;
}

/** Avoid three cards in a row from the same primary topic when possible. */
export function diversify<T extends RankCandidate>(items: T[]): T[] {
  const out = [...items];
  for (let i = 2; i < out.length; i++) {
    const t = out[i].topics[0];
    if (t && out[i - 1].topics[0] === t && out[i - 2].topics[0] === t) {
      const j = out.findIndex((x, k) => k > i && x.topics[0] !== t);
      if (j > -1) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}
