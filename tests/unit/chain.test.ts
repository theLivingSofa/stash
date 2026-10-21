import { describe, expect, it } from "vitest";
import { buildPage, BUFFER_TARGET, type CardRow, type FeedFilter, type FeedRepo, type Tier } from "@/lib/feed/chain";

function row(id: string, topic: string, extra: Partial<CardRow> = {}): CardRow {
  return {
    id, title: `t${id}`, text: `idea ${id}`, topics: [topic], why_it_matters: null, main_concept: null,
    back: null, learn_more_url: null, source_title: "s", source_author: null, source_url: "https://x", source_domain: "x",
    created_at: "2026-10-20T00:00:00Z", seen_at: null, saved_at: null, reaction: 0, ...extra,
  };
}

/** In-memory repo mirroring the SQL semantics of feed_candidates/serve_ideas. */
class FakeRepo implements FeedRepo {
  served = new Map<string, Set<string>>();
  constructor(public rows: CardRow[]) {}
  private inSession(s: string, id: string) {
    return this.served.get(s)?.has(id) ?? false;
  }
  private matches(r: CardRow, f: FeedFilter) {
    return (!f.topic || r.topics.includes(f.topic)) && (!f.concept || r.text.includes(f.concept));
  }
  async candidates(s: string, tier: Tier, f: FeedFilter, limit: number) {
    if (tier !== "unseen") throw new Error("feed must only ask for unseen ideas");
    return this.rows.filter((r) => !r.seen_at && (r.reaction ?? 0) >= 0 && !this.inSession(s, r.id) && this.matches(r, f)).slice(0, limit);
  }
  async affinity() {
    return new Map<string, number>();
  }
  async serve(s: string, ids: string[]) {
    const set = this.served.get(s) ?? new Set<string>();
    ids.forEach((i) => set.add(i));
    this.served.set(s, set);
  }
  async resetSession(s: string) {
    this.served.delete(s);
  }
  async unseenCount() {
    return this.rows.filter((r) => !r.seen_at && (r.reaction ?? 0) >= 0).length;
  }
}

const many = (n: number, topic = "science", prefix = "u") => Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, topic));

describe("buildPage (no-repeat endless feed)", () => {
  it("returns a full page of unseen ideas", async () => {
    const repo = new FakeRepo(many(50));
    const page = await buildPage(repo, { sessionId: "s1", filter: {} });
    expect(page.cards).toHaveLength(20);
    expect(page.cards.every((c) => c.kind === "new")).toBe(true);
  });

  it("never serves a seen, or a disliked, idea", async () => {
    const rows = [...many(5), row("seen1", "science", { seen_at: "2026-10-21T00:00:00Z" }), row("saved1", "science", { seen_at: "x", saved_at: "x" }), row("bad", "science", { reaction: -1 })];
    const page = await buildPage(new FakeRepo(rows), { sessionId: "s1", filter: {} });
    const ids = page.cards.map((c) => c.id);
    expect(ids).not.toContain("seen1");
    expect(ids).not.toContain("saved1");
    expect(ids).not.toContain("bad");
    expect(ids).toHaveLength(5);
  });

  it("does not repeat within a session across pages", async () => {
    const repo = new FakeRepo(many(45));
    const seen = new Set<string>();
    for (let p = 0; p < 2; p++) {
      const page = await buildPage(repo, { sessionId: "s1", filter: {} });
      for (const c of page.cards) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
    }
    expect(seen.size).toBe(40);
  });

  it("brings back ideas dealt in an earlier session that were never seen", async () => {
    const repo = new FakeRepo(many(20));
    const first = await buildPage(repo, { sessionId: "old", filter: {} });
    // Reader saw only the first two.
    for (const c of first.cards.slice(0, 2)) repo.rows.find((r) => r.id === c.id)!.seen_at = "now";
    const next = await buildPage(repo, { sessionId: "new", filter: {} });
    expect(next.cards).toHaveLength(18);
    expect(next.cards.map((c) => c.id)).not.toContain(first.cards[0].id);
  });

  it("widens a dry filter to the whole feed and marks the boundary", async () => {
    const repo = new FakeRepo([...many(3, "art", "a"), ...many(30, "science", "s")]);
    const page = await buildPage(repo, { sessionId: "s1", filter: { topic: "art" } });
    expect(page.cards).toHaveLength(20);
    expect(page.cards.slice(0, 3).every((c) => c.topics[0] === "art")).toBe(true);
    expect(page.cards[3].beyond).toBe("art");
    expect(page.widenedFrom).toBe("art");
    expect(page.needFocus).toBe(true);
  });

  it("asks for ingest whenever the unseen buffer is below target", async () => {
    const low = await buildPage(new FakeRepo(many(30)), { sessionId: "s", filter: {} });
    expect(low.needIngest).toBe(true);
    const full = await buildPage(new FakeRepo(many(BUFFER_TARGET + 5)), { sessionId: "s", filter: {} });
    expect(full.needIngest).toBe(false);
  });

  it("returns an empty page (caller ingests, client shows 'finding new ideas') rather than repeating", async () => {
    const rows = many(5).map((r) => ({ ...r, seen_at: "earlier" }));
    const page = await buildPage(new FakeRepo(rows), { sessionId: "s", filter: {} });
    expect(page.cards).toHaveLength(0);
    expect(page.needIngest).toBe(true);
  });
});
