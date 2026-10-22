import "server-only";
import { db } from "./db";
import { embedTexts } from "./llm";

export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);

/**
 * Embedding for a search phrase, cached in the DB so each distinct phrase costs
 * one free Gemini embedding request at most. Returns null if embeddings are
 * unavailable; search then falls back to keywords only.
 */
export async function queryEmbedding(q: string): Promise<number[] | null> {
  const key = normalizeQuery(q);
  if (key.length < 2) return null;
  const { data } = await db().from("query_embeddings").select("embedding").eq("q", key).maybeSingle();
  if (data?.embedding) {
    const e = typeof data.embedding === "string" ? (JSON.parse(data.embedding) as number[]) : (data.embedding as number[]);
    return e;
  }
  const [e] = (await embedTexts([key]).catch(() => null)) ?? [];
  if (!e) return null;
  await db().from("query_embeddings").upsert({ q: key, embedding: JSON.stringify(e) });
  return e;
}
