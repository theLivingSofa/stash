import { describe, expect, it } from "vitest";
import { computeStreak } from "@/lib/feed/streak";
import { canonicalizeUrl, truncateWords } from "@/lib/ingest/fetch";
import { isLowQualityTitle, jaccard } from "@/lib/ingest/quality";
import { pickDueSources } from "@/lib/ingest/run";
import { normalizeTopic } from "@/lib/topics";
import { pickExcerpt } from "@/lib/ingest/discover";
import type { SourceDef } from "@/lib/ingest/sources";

describe("streak", () => {
  it("counts consecutive days ending today or yesterday", () => {
    expect(computeStreak(["2026-10-22", "2026-10-21", "2026-10-20", "2026-10-18"], "2026-10-22")).toBe(3);
    expect(computeStreak(["2026-10-21", "2026-10-20"], "2026-10-22")).toBe(2);
    expect(computeStreak(["2026-10-19"], "2026-10-22")).toBe(0);
  });
});

describe("ingest helpers", () => {
  it("canonicalises URLs for dedupe", () => {
    expect(canonicalizeUrl("http://www.Example.com/a/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/a?a=1&b=2");
  });
  it("truncates to a word budget", () => {
    const t = truncateWords("one two three four five. six seven", 5);
    expect(t.split(/\s+/).length).toBeLessThanOrEqual(5);
  });
  it("flags clickbait and roundups", () => {
    expect(isLowQualityTitle("10 things you won't believe about cats")).toBe(true);
    expect(isLowQualityTitle("Assorted links")).toBe(true);
    expect(isLowQualityTitle("Why the Stoics feared anger")).toBe(false);
  });
  it("detects near-duplicate text", () => {
    expect(jaccard("the quick brown fox jumps over the lazy dog", "the quick brown fox jumps over the lazy cat")).toBeGreaterThan(0.5);
    expect(jaccard("entirely different words here", "nothing alike at all friend")).toBe(0);
  });
  it("maps loose topic labels to canonical ones", () => {
    expect(normalizeTopic("Ethics")).toBe("philosophy");
    expect(normalizeTopic("neuroscience")).toBe("psychology");
    expect(normalizeTopic("Mathematics")).toBe("mathematics");
    expect(normalizeTopic("knitting")).toBeNull();
  });
  it("picks excerpts from the body of a book", () => {
    const paras = Array.from({ length: 200 }, (_, i) => `Paragraph ${i} has some words in it for testing.`).join("\n\n");
    const { excerpt, offset } = pickExcerpt(paras, () => 0.5);
    expect(offset).toBeGreaterThanOrEqual(20);
    expect(excerpt.length).toBeGreaterThan(100);
  });
  it("chooses due sources and favours thin topics", () => {
    const sources: SourceDef[] = [
      { id: "a", name: "a", kind: "rss", topic: "art", url: "x", everyMin: 60 },
      { id: "b", name: "b", kind: "rss", topic: "science", url: "x", everyMin: 60 },
      { id: "c", name: "c", kind: "rss", topic: "science", url: "x", everyMin: 60 },
    ];
    const now = Date.now();
    const health = new Map([["c", { id: "c", last_polled_at: new Date(now - 10 * 60_000).toISOString(), fail_count: 0 }]]);
    const chosen = pickDueSources(sources, health, new Map([["science", 100], ["art", 0]]), 2, now, () => 0);
    expect(chosen.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("read-aloud chunking", async () => {
  const { chunkText } = await import("@/lib/client/speak");
  it("splits long text into short sentence chunks without losing words", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} explains one small part of the idea in plain words.`).join(" ");
    const chunks = chunkText(text, 220);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
    expect(chunks.join(" ").split(/\s+/).length).toBe(text.split(/\s+/).length);
  });
  it("breaks a single very long sentence", () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(long, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
});
