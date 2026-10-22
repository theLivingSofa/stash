import { z } from "zod";
import { jsonrepair } from "jsonrepair";

export const wordCount = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const BackSchema = z.object({
  concept: trimmed(40, 1600),
  origin: trimmed(20, 1600),
  reasoning: trimmed(40, 1800),
  example: trimmed(20, 1200),
  related: z
    .array(z.string().trim().min(2).max(60))
    .min(1)
    .transform((a) => Array.from(new Set(a)).slice(0, 4)),
  confidence: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.enum(["high", "medium", "low"]))
    .catch("medium"),
});

export const LlmIdeaSchema = z
  .object({
    source_index: z.coerce.number().int().min(1).max(10).catch(1),
    title: z.string().trim().max(120).nullish(),
    text: trimmed(40, 900),
    topics: z.array(z.string().trim().min(2).max(40)).min(1).max(5),
    why_it_matters: z.string().trim().max(240).nullish(),
    main_concept: z.string().trim().max(100).nullish(),
    back: BackSchema,
  })
  .refine((i) => wordCount(i.text) <= 110, { message: "front text over 100 words", path: ["text"] })
  .refine(
    (i) => {
      const n = wordCount([i.back.concept, i.back.origin, i.back.reasoning, i.back.example].join(" "));
      return n >= 90 && n <= 450;
    },
    { message: "back must be roughly 150-300 words", path: ["back"] },
  );

export type LlmIdea = z.infer<typeof LlmIdeaSchema>;

export const LlmBatchSchema = z.object({ ideas: z.array(z.unknown()) });

/**
 * Extract a JSON value from model output that may include code fences,
 * prose before/after, or a bare array instead of {"ideas": [...]}.
 */
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const start = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;
  if (start === -1) throw new Error("no JSON found in model output");
  const close = s[start] === "[" ? "]" : "}";
  const end = s.lastIndexOf(close);
  if (end <= start) throw new Error("unterminated JSON in model output");
  const slice = s.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"); // trailing commas
  try {
    return JSON.parse(slice);
  } catch {
    // Small model slips (a missing colon or comma, stray quotes) are fixed
    // locally instead of spending another LLM call. The slice ends at the last
    // complete object, so a reply cut off mid-idea drops that idea, never keeps half of it.
    return JSON.parse(jsonrepair(slice));
  }
}

export interface ParsedBatch {
  ideas: LlmIdea[];
  rejected: { index: number; reason: string }[];
}

/** Parse and validate one model response. Throws if the payload is unusable. */
export function parseIdeaBatch(raw: string): ParsedBatch {
  const json = extractJson(raw);
  const wrapped = Array.isArray(json) ? { ideas: json } : json;
  const batch = LlmBatchSchema.parse(wrapped);
  const ideas: LlmIdea[] = [];
  const rejected: ParsedBatch["rejected"] = [];
  batch.ideas.forEach((candidate, index) => {
    const r = LlmIdeaSchema.safeParse(candidate);
    if (r.success) ideas.push(r.data);
    else rejected.push({ index, reason: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  });
  if (batch.ideas.length > 0 && ideas.length === 0) {
    throw new Error(`all ${batch.ideas.length} ideas failed validation: ${rejected[0]?.reason}`);
  }
  return { ideas, rejected };
}

export const DeepBackResponseSchema = z.object({ back: BackSchema }).or(BackSchema.transform((back) => ({ back })));

// ---- API inputs ----

export const LoginInput = z.object({ passcode: z.string().min(1).max(200) });

export const FeedQuery = z.object({
  cursor: z.string().max(2000).optional(),
  topic: z.string().trim().max(60).optional(),
  concept: z.string().trim().max(100).optional(),
});

export const EventsInput = z.object({
  events: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(["seen", "save", "unsave", "like", "dislike", "unreact", "flip", "share"]),
      }),
    )
    .min(1)
    .max(100),
});

export const CollectionInput = z.object({ name: z.string().trim().min(1).max(60) });
export const CollectionItemInput = z.object({ ideaId: z.uuid(), add: z.boolean() });
