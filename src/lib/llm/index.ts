import "server-only";
import { listEnv } from "../env";
import { EMBEDDING, resolveProviders, type ProviderId } from "./config";
import { LlmRouter } from "./router";
import { DbLlmStore } from "./store";

export function providerKeys(): Partial<Record<ProviderId, string[]>> {
  const keys: Partial<Record<ProviderId, string[]>> = {};
  for (const p of resolveProviders()) keys[p.id] = listEnv(p.envVar);
  return keys;
}

/** A fresh router per request/run (cooldowns are loaded from the DB once). */
export function createRouter(): LlmRouter {
  return new LlmRouter({ providers: resolveProviders(), keys: providerKeys(), store: new DbLlmStore() });
}

let embedRr = 0;

/**
 * Embed texts with Gemini's free embedding model. Returns null on any failure:
 * embeddings only sharpen dedupe, so they are never allowed to block ingest.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const keys = listEnv("GEMINI_API_KEYS");
  if (keys.length === 0 || texts.length === 0) return null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(embedRr++ + i) % keys.length];
    try {
      const res = await fetch(EMBEDDING.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: EMBEDDING.model,
            content: { parts: [{ text }] },
            taskType: "SEMANTIC_SIMILARITY",
            outputDimensionality: EMBEDDING.dimensions,
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { embeddings?: { values: number[] }[] };
      if (data.embeddings?.length === texts.length) return data.embeddings.map((e) => normalize(e.values));
    } catch {
      /* try next key */
    }
  }
  return null;
}

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
