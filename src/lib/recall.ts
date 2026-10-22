import "server-only";
import { db, must } from "./db";
import { createRouter } from "./llm";

/** Due recall cards for this reader (not yet dealt in this feed session). */
export async function dueRecall(userId: string, sessionId: string, limit: number) {
  const rows = must(await db().rpc("recall_due", { p_user: userId, p_session: sessionId, p_limit: limit }), "recall_due") as
    | { idea_id: string; box: number; question: string | null }[]
    | null;
  return rows ?? [];
}

/** Record an answer. Returns days until the card comes back, or null if it isn't scheduled. */
export async function answerRecall(userId: string, ideaId: string, ok: boolean): Promise<number | null> {
  const data = must(await db().rpc("recall_answer", { p_user: userId, p_idea: ideaId, p_ok: ok }), "recall_answer");
  return data === null ? null : Number(data);
}

const SYSTEM = `You write one recall question for a flashcard about a short idea.
The honest answer to the question must be the idea's main point, so a reader who remembers the idea can answer it.
Rules: one sentence, at most 18 words, ends with "?", plain everyday words, no yes/no question, never reveal the answer.
Reply with JSON only: {"question": "..."}`;

export function parseQuestion(raw: string): string {
  let text = raw.trim();
  // The LLM router asks for JSON; accept {"question": "..."} or a bare line.
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const v = (JSON.parse(json) as { question?: unknown }).question;
      if (typeof v === "string") text = v;
    } catch {
      /* fall through to plain text */
    }
  }
  const q = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const cleaned = q.replace(/^(question|q)\s*[:.-]\s*/i, "").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!cleaned.endsWith("?") || cleaned.length < 12 || cleaned.length > 180) throw new Error("not a question");
  return cleaned;
}

/**
 * Write recall questions for ideas that don't have one (once per idea, shared by
 * all readers). Small and best effort: a card without one falls back to its title.
 */
export async function ensureQuestions(ideaIds: string[], budgetMs = 20_000): Promise<number> {
  if (ideaIds.length === 0) return 0;
  const rows = must(
    await db().from("ideas").select("id, title, text").in("id", ideaIds).is("recall_q", null),
    "ideas without question",
  ) as { id: string; title: string | null; text: string }[];
  if (rows.length === 0) return 0;
  const router = createRouter();
  const deadline = Date.now() + budgetMs;
  let made = 0;
  for (const r of rows) {
    if (Date.now() > deadline - 3_000) break;
    try {
      const res = await router.complete(
        { system: SYSTEM, user: `${r.title ? `Title: ${r.title}\n` : ""}Idea: ${r.text}`, maxTokens: 400, temperature: 0.3, deadline },
        parseQuestion,
      );
      must(await db().from("ideas").update({ recall_q: res.value }).eq("id", r.id), "save question");
      made++;
    } catch (e) {
      console.warn("[recall] question failed", r.id, (e as Error).message);
    }
  }
  return made;
}

/** A random trivia (read, not kept) whose question is ready, or null. */
export async function pickTrivia(userId: string, sessionId: string): Promise<{ idea_id: string; question: string } | null> {
  const { data, error } = await db().rpc("trivia_pick", { p_user: userId, p_session: sessionId });
  if (error) return null;
  const row = (data as { idea_id: string; question: string }[] | null)?.[0];
  return row ?? null;
}

/** Keep a few trivia questions written ahead, so one is ready when it's due. */
export async function prepareTrivia(userId: string, keep = 3, batch = 2): Promise<number> {
  const { data: ready } = await db().rpc("trivia_ready_count", { p_user: userId });
  if (Number(ready ?? 0) >= keep) return 0;
  const { data: ids } = await db().rpc("trivia_to_prepare", { p_user: userId, p_n: batch });
  return ensureQuestions(((ids as string[] | null) ?? []).filter(Boolean), 25_000);
}

export async function logTrivia(userId: string, ideaId: string, ok: boolean) {
  must(await db().from("trivia_log").insert({ user_id: userId, idea_id: ideaId, ok }), "trivia log");
}
