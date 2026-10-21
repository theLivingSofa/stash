import { describe, expect, it } from "vitest";
import { extractJson, parseIdeaBatch, wordCount } from "@/lib/schemas";

const back = {
  concept: "A clear explanation of the concept from first principles, written for a curious reader who has never met it before today, and it is worth slowing down to see why it matters so much in ordinary situations.",
  origin: "It grew out of work by several thinkers in the twentieth century, and it was refined over decades of debate in the field, with each generation adding nuance and correcting earlier overstatements.",
  reasoning: "People accept it because experiments and arguments repeatedly support it, though critics point out important limits and exceptions to it that are still argued about today.",
  example: "When you choose the shorter queue at a shop and it moves slower, you are seeing this idea play out in daily life.",
  related: ["Idea A", "Idea B", "Idea B"],
  confidence: "HIGH",
};
const idea = (over: Record<string, unknown> = {}) => ({
  source_index: 1,
  title: "A short title",
  text: "This is a standalone insight that explains one durable idea in plain language so that it makes sense on its own without the source.",
  topics: ["philosophy"],
  why_it_matters: "Because it helps.",
  main_concept: "Example concept",
  back,
  ...over,
});

describe("extractJson", () => {
  it("handles fences, prose and trailing commas", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a":[1,2,],} hope that helps')).toEqual({ a: [1, 2] });
    expect(extractJson("[1,2]")).toEqual([1, 2]);
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("parseIdeaBatch", () => {
  it("accepts a valid batch and normalises fields", () => {
    const r = parseIdeaBatch(JSON.stringify({ ideas: [idea()] }));
    expect(r.ideas).toHaveLength(1);
    expect(r.ideas[0].back.confidence).toBe("high");
    expect(r.ideas[0].back.related).toEqual(["Idea A", "Idea B"]);
  });

  it("accepts a bare array", () => {
    expect(parseIdeaBatch(JSON.stringify([idea()])).ideas).toHaveLength(1);
  });

  it("drops invalid ideas but keeps valid ones", () => {
    const long = Array.from({ length: 130 }, () => "word").join(" ");
    const r = parseIdeaBatch(JSON.stringify({ ideas: [idea(), idea({ text: long }), idea({ back: { ...back, concept: "short" } })] }));
    expect(r.ideas).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
  });

  it("throws when every idea is invalid (so the router retries)", () => {
    expect(() => parseIdeaBatch(JSON.stringify({ ideas: [idea({ topics: [] })] }))).toThrow(/failed validation/);
  });

  it("allows an empty list for substance-free sources", () => {
    expect(parseIdeaBatch('{"ideas":[]}').ideas).toEqual([]);
  });

  it("counts words", () => {
    expect(wordCount("  one two   three ")).toBe(3);
  });
});
