import { describe, expect, it } from "vitest";
import { affinityScore, diversify, exploratoryTopics, freshness, rankIdeas } from "@/lib/feed/rank";

const seeded = (seed = 42) => {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
};
const NOW = Date.parse("2026-10-22T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function pool() {
  const topics = ["philosophy", "science", "history", "art", "economics"];
  return Array.from({ length: 100 }, (_, i) => ({ id: `i${i}`, topics: [topics[i % topics.length]], createdAt: daysAgo(i % 10) }));
}

describe("affinity", () => {
  it("is zero with no signal and grows with affinity, bounded", () => {
    expect(affinityScore(["x"], new Map())).toBe(0);
    const a = affinityScore(["x"], new Map([["x", 3]]));
    const b = affinityScore(["x"], new Map([["x", 30]]));
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(2);
    expect(affinityScore(["x"], new Map([["x", -6]]))).toBeLessThan(0);
  });

  it("freshness decays with age", () => {
    expect(freshness(daysAgo(0), NOW)).toBeGreaterThan(freshness(daysAgo(5), NOW));
    expect(freshness(daysAgo(5), NOW)).toBeCloseTo(0.3, 5);
  });

  it("exploratory topics are the low-affinity half", () => {
    const aff = new Map([["a", 5], ["b", 4], ["c", 0], ["d", -1]]);
    const ex = exploratoryTopics(["a", "b", "c", "d"], aff);
    expect([...ex].sort()).toEqual(["c", "d"]);
  });
});

describe("rankIdeas", () => {
  it("returns n unique items from the pool", () => {
    const out = rankIdeas(pool(), new Map(), { n: 20, now: NOW, rng: seeded() });
    expect(out).toHaveLength(20);
    expect(new Set(out.map((o) => o.id)).size).toBe(20);
  });

  it("favours liked topics but keeps a ~20% exploration slice", () => {
    const aff = new Map([["philosophy", 12]]);
    const out = rankIdeas(pool(), aff, { n: 20, now: NOW, rng: seeded(7) });
    const phil = out.filter((o) => o.topics[0] === "philosophy").length;
    const other = out.length - phil;
    expect(phil).toBeGreaterThanOrEqual(12); // most of the page follows affinity
    expect(other).toBeGreaterThanOrEqual(4); // exploration slice survives (20% of 20)
  });

  it("puts ideas with read-aloud audio ready first when there are enough", () => {
    const withAudio = pool().map((c, i) => ({ ...c, audio: i % 4 === 0 })); // 25 of 100 ready
    const out = rankIdeas(withAudio, new Map([["philosophy", 12]]), { n: 20, now: NOW, rng: seeded(3) });
    expect(out).toHaveLength(20);
    expect(out.every((o) => o.audio)).toBe(true);
  });

  it("still fills the page when few ideas have audio", () => {
    const withAudio = pool().map((c, i) => ({ ...c, audio: i < 5 }));
    const out = rankIdeas(withAudio, new Map(), { n: 20, now: NOW, rng: seeded(5) });
    expect(out).toHaveLength(20);
    expect(out.filter((o) => o.audio)).toHaveLength(5);
  });

  it("handles fewer candidates than requested", () => {
    expect(rankIdeas(pool().slice(0, 3), new Map(), { n: 20, now: NOW })).toHaveLength(3);
    expect(rankIdeas([], new Map(), { n: 20 })).toEqual([]);
  });

  it("diversify avoids three of the same topic in a row when it can", () => {
    const items = ["a", "a", "a", "b", "a"].map((t, i) => ({ id: String(i), topics: [t], createdAt: daysAgo(0) }));
    const out = diversify(items);
    for (let i = 2; i < out.length; i++) {
      const run = out[i].topics[0] === out[i - 1].topics[0] && out[i].topics[0] === out[i - 2].topics[0];
      if (i < 4) expect(run).toBe(false);
    }
  });
});
