import "server-only";
import { db, must } from "../db";
import { createRouter } from "../llm";
import type { LlmRouter } from "../llm/router";
import { DeepBackResponseSchema, extractJson } from "../schemas";
import type { IdeaBack } from "../types";
import { DEEP_SYSTEM, deepUserPrompt } from "./prompt";
import { groundConcept } from "./wiki";

export interface DeepInput {
  id: string;
  title: string | null;
  text: string;
  main_concept: string | null;
  source_title: string;
  source_domain: string;
  learn_more_url: string | null;
}

export function parseDeepBack(raw: string): IdeaBack {
  return DeepBackResponseSchema.parse(extractJson(raw)).back as IdeaBack;
}

/** Generate a missing BACK for one idea (LLM, grounded on Wikipedia when possible). */
export async function generateBack(
  idea: DeepInput,
  router: LlmRouter = createRouter(),
  ground: typeof groundConcept = groundConcept,
): Promise<{ back: IdeaBack; learnMoreUrl: string | null; provider: string }> {
  const g = idea.main_concept ? await ground(idea.main_concept).catch(() => null) : null;
  const result = await router.complete(
    {
      system: DEEP_SYSTEM,
      user: deepUserPrompt({
        title: idea.title,
        text: idea.text,
        sourceTitle: idea.source_title,
        sourceDomain: idea.source_domain,
        background: g ? { title: g.title, extract: g.extract.slice(0, 1_500) } : null,
      }),
      maxTokens: 2_000,
      temperature: 0.4,
      deadline: Date.now() + 40_000,
      timeoutMs: 30_000,
    },
    parseDeepBack,
  );
  return { back: result.value, learnMoreUrl: idea.learn_more_url ?? g?.url ?? null, provider: `${result.provider}/${result.model}` };
}

/** Return the idea's BACK, generating and caching it if missing. */
export async function ensureBack(id: string): Promise<{ back: IdeaBack; learnMoreUrl: string | null; generated: boolean }> {
  const row = must(
    await db()
      .from("ideas")
      .select("id, title, text, main_concept, source_title, source_domain, learn_more_url, back")
      .eq("id", id)
      .maybeSingle(),
    "load idea",
  ) as (DeepInput & { back: IdeaBack | null }) | null;
  if (!row) throw new Error("not found");
  if (row.back) return { back: row.back, learnMoreUrl: row.learn_more_url, generated: false };
  const { back, learnMoreUrl } = await generateBack(row);
  await db().from("ideas").update({ back, learn_more_url: learnMoreUrl }).eq("id", id).is("back", null);
  return { back, learnMoreUrl, generated: true };
}
