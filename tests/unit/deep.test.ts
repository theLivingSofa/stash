import { describe, expect, it } from "vitest";
import { generateBack, parseDeepBack } from "@/lib/ingest/deep";
import { LlmRouter, MemoryLlmStore } from "@/lib/llm/router";
import type { ProviderConfig } from "@/lib/llm/config";

const back = {
  concept: "A clear explanation of the concept from first principles, written for a curious reader who has never met it before, and it is worth slowing down to see why it matters so much in ordinary situations.",
  origin: "It grew out of work by several thinkers in the twentieth century, refined over decades of debate in the field, with each generation adding nuance and correcting earlier overstatements.",
  reasoning: "People accept it because experiments and arguments support it, though critics point out important limits and exceptions that are still argued about today.",
  example: "When you choose the shorter queue at a shop and it moves slower, you are seeing this idea in daily life.",
  related: ["Idea A", "Idea B"],
  confidence: "low",
};

describe("back-side fallback", () => {
  it("parses both {back: …} and a bare back object", () => {
    expect(parseDeepBack(JSON.stringify({ back })).confidence).toBe("low");
    expect(parseDeepBack("```json\n" + JSON.stringify(back) + "\n```").related).toEqual(["Idea A", "Idea B"]);
    expect(() => parseDeepBack('{"back":{"concept":"x"}}')).toThrow();
  });

  it("generates a back with grounding and falls back to the grounding URL for 'learn more'", async () => {
    const providers: ProviderConfig[] = [
      { id: "groq", label: "Q", baseUrl: "https://q.test", envVar: "Q", jsonMode: true, keyUrl: "", models: [{ name: "q" }] },
    ];
    let prompt = "";
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      prompt = JSON.parse(String(init.body)).messages[1].content;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ back }) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const router = new LlmRouter({ providers, keys: { groq: ["k"] }, store: new MemoryLlmStore(), fetch: fetchImpl, log: () => {} });
    const ground = async () => ({ title: "Concept X", extract: "Background facts about concept X.", url: "https://en.wikipedia.org/wiki/X", description: null, type: "standard" });
    const r = await generateBack(
      { id: "1", title: "T", text: "Front text", main_concept: "Concept X", source_title: "S", source_domain: "d", learn_more_url: null },
      router,
      ground,
    );
    expect(r.back.concept).toContain("first principles");
    expect(r.learnMoreUrl).toBe("https://en.wikipedia.org/wiki/X");
    expect(prompt).toContain("Background facts about concept X.");
  });
});
