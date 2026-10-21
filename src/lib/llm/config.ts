/**
 * LLM providers, tried in this order. Every provider here has a free tier and
 * speaks the OpenAI-compatible /chat/completions API.
 *
 * HOW TO UPDATE MODELS (free model names change often):
 *   1. List what your key can use, e.g.
 *        curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $KEY" | jq -r '.data[].id'
 *      (Gemini: https://generativelanguage.googleapis.com/v1beta/openai/models,
 *       OpenRouter free: https://openrouter.ai/api/v1/models then filter ids ending in ":free")
 *      or run `npm run llm:check`, which does this for every provider.
 *   2. Edit the `models` arrays below (first = preferred), or override without a
 *      deploy by setting env LLM_MODELS_<PROVIDER>="model-a,model-b"
 *      (e.g. LLM_MODELS_GROQ="llama-3.3-70b-versatile").
 *   3. `dailyLimit` is the free-tier requests/day per key; when today's usage
 *      reaches it the router skips that model until UTC midnight. Leave it
 *      undefined if unknown; 429s are handled either way.
 */

export type ProviderId = "gemini" | "groq" | "cerebras" | "openrouter" | "mistral";

export interface ModelConfig {
  name: string;
  dailyLimit?: number;
  /** Extra fields merged into the request body (e.g. reasoning controls). */
  extra?: Record<string, unknown>;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** Env var holding one or more comma-separated API keys. */
  envVar: string;
  models: ModelConfig[];
  /** Whether to send response_format: { type: "json_object" }. */
  jsonMode: boolean;
  headers?: Record<string, string>;
  /** Where to get a free key (shown in docs/admin). */
  keyUrl: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GEMINI_API_KEYS",
    jsonMode: true,
    keyUrl: "https://aistudio.google.com/apikey",
    // Verified 2026-10-22. gemini-2.5-flash-lite is closed to new users.
    models: [
      { name: "gemini-3.5-flash", extra: { reasoning_effort: "low" } },
      { name: "gemini-2.5-flash", extra: { reasoning_effort: "none" } },
      { name: "gemini-3.5-flash-lite" },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEYS",
    jsonMode: true,
    keyUrl: "https://console.groq.com/keys",
    // Verified 2026-10-22 (Llama 3.3 70B has been retired on Groq).
    models: [
      { name: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
      { name: "qwen/qwen3.8-27b" },
      { name: "openai/gpt-oss-20b", extra: { reasoning_effort: "low" } },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envVar: "CEREBRAS_API_KEYS",
    jsonMode: true,
    keyUrl: "https://cloud.cerebras.ai",
    // Not verified (no key configured yet); run `npm run llm:check` after adding one.
    models: [{ name: "gpt-oss-120b", extra: { reasoning_effort: "low" } }, { name: "qwen-3-235b-a22b-instruct-2507" }],
  },
  {
    id: "openrouter",
    label: "OpenRouter (free models)",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEYS",
    jsonMode: false,
    keyUrl: "https://openrouter.ai/settings/keys",
    headers: { "HTTP-Referer": "https://github.com/theLivingSofa/stash", "X-Title": "Stash" },
    // Free models rotate frequently; ids must end in ":free". Verified 2026-10-22.
    models: [
      { name: "minimax/minimax-m3.1-flash:free" },
      { name: "google/gemma-4-31b-it:free" },
      { name: "google/gemma-4-26b-a4b-it:free" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envVar: "MISTRAL_API_KEYS",
    jsonMode: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    // Free "Experiment" tier: ~1 request/second. Verified 2026-10-22.
    models: [{ name: "mistral-small-latest" }, { name: "mistral-medium-latest" }],
  },
];

/** Gemini embeddings (free tier) for semantic near-duplicate detection. */
export const EMBEDDING = {
  url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
  model: "models/gemini-embedding-001",
  dimensions: 768,
};

/** Apply LLM_MODELS_<PROVIDER> env overrides. */
export function resolveProviders(env: Record<string, string | undefined> = process.env): ProviderConfig[] {
  return PROVIDERS.map((p) => {
    const override = env[`LLM_MODELS_${p.id.toUpperCase()}`];
    if (!override?.trim()) return p;
    const names = override.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      ...p,
      models: names.map((name) => p.models.find((m) => m.name === name) ?? { name }),
    };
  });
}
