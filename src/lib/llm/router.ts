import type { ModelConfig, ProviderConfig, ProviderId } from "./config";

export interface Slot {
  provider: ProviderId;
  model: string;
  keyId: string;
}

export interface Cooldown {
  until: number; // epoch ms
  level: number;
  lastError?: string;
}

/** Persistence for cooldowns and usage counters (DB in prod, memory in tests). */
export interface LlmStore {
  loadCooldowns(): Promise<Map<string, Cooldown>>;
  loadUsageToday(): Promise<Map<string, number>>;
  saveCooldown(slot: Slot, cooldown: Cooldown | null): Promise<void>;
  recordUsage(slot: Slot, ok: boolean): Promise<void>;
}

export interface CompleteRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Absolute deadline (epoch ms). Attempts that cannot finish in time are skipped. */
  deadline?: number;
  /** Per-attempt timeout (ms). */
  timeoutMs?: number;
}

export interface CompleteResult<T> {
  value: T;
  provider: ProviderId;
  model: string;
  keyId: string;
  ms: number;
  attempts: AttemptLog[];
}

export interface AttemptLog {
  provider: ProviderId;
  model: string;
  keyId: string;
  outcome: "ok" | "skipped" | "cooldown" | "error" | "invalid";
  detail?: string;
}

export class AllProvidersExhaustedError extends Error {
  constructor(public attempts: AttemptLog[]) {
    super(
      `All LLM providers exhausted (${attempts.length} attempts): ` +
        attempts
          .filter((a) => a.outcome !== "skipped")
          .slice(-4)
          .map((a) => `${a.provider}/${a.model}: ${a.outcome} ${a.detail ?? ""}`.trim())
          .join(" | "),
    );
    this.name = "AllProvidersExhaustedError";
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public retryAfterSec: number | null,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export interface RouterDeps {
  providers: ProviderConfig[];
  keys: Partial<Record<ProviderId, string[]>>;
  store: LlmStore;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
  hashKey?: (key: string) => string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

export const slotKey = (s: Slot) => `${s.provider}|${s.model}|${s.keyId}`;

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5);
}

/** Decide what a failure means for this key/model. Exported for tests. */
export function classifyFailure(
  err: unknown,
  prevLevel: number,
  now: number,
): { cooldownUntil: number | null; level: number; reason: string } {
  const level = prevLevel + 1;
  if (err instanceof HttpError) {
    const body = err.body.toLowerCase();
    if (err.status === 429) {
      const daily = /per ?day|perday|daily|requests per day|rpd|quota exceeded for metric.*day/.test(body);
      if (daily) return { cooldownUntil: nextUtcMidnight(now), level, reason: "daily quota" };
      const backoff = err.retryAfterSec != null ? err.retryAfterSec * 1000 : Math.min(MIN * 2 ** (level - 1), 6 * HOUR);
      return { cooldownUntil: now + backoff, level, reason: "rate limited" };
    }
    if (err.status === 401 || err.status === 403) {
      return { cooldownUntil: now + 12 * HOUR, level, reason: `auth ${err.status}` };
    }
    if (
      err.status === 404 ||
      (err.status === 400 && /model|not found|does not exist|decommission|unsupported/.test(body) && !/context|token/.test(body))
    ) {
      return { cooldownUntil: now + 24 * HOUR, level, reason: "model unavailable" };
    }
    if (err.status === 413 || (err.status === 400 && /context|too long|too large|token/.test(body))) {
      // Request too big for this model; not the key's fault. Short pause only.
      return { cooldownUntil: now + MIN, level: prevLevel, reason: "request too large" };
    }
    if (err.status === 402) {
      return { cooldownUntil: nextUtcMidnight(now), level, reason: "payment required (free credits used)" };
    }
    if (err.status >= 500) {
      return { cooldownUntil: now + Math.min(30_000 * 2 ** (level - 1), HOUR), level, reason: `server ${err.status}` };
    }
    return { cooldownUntil: null, level: prevLevel, reason: `http ${err.status}` };
  }
  // Network error / timeout.
  return { cooldownUntil: now + Math.min(30_000 * 2 ** (level - 1), HOUR), level, reason: "timeout/network" };
}

/**
 * Routes chat completions across free-tier providers.
 * Order: provider priority -> model priority -> keys (round-robin).
 * A failing key/model is cooled down (exponential backoff, persisted) and the
 * next one is tried. Output is validated by the caller's `parse`; on invalid
 * output the same model gets one repair attempt before moving on.
 */
export class LlmRouter {
  private cooldowns: Map<string, Cooldown> | null = null;
  private usage: Map<string, number> | null = null;
  private rr = new Map<ProviderId, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly hashKey: (key: string) => string;

  constructor(private deps: RouterDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((m) => console.log(m));
    this.hashKey = deps.hashKey ?? defaultHash;
  }

  /** Providers that have at least one key configured. */
  configuredProviders(): ProviderConfig[] {
    return this.deps.providers.filter((p) => (this.deps.keys[p.id]?.length ?? 0) > 0);
  }

  private async ensureLoaded() {
    if (!this.cooldowns) this.cooldowns = await this.deps.store.loadCooldowns().catch(() => new Map());
    if (!this.usage) this.usage = await this.deps.store.loadUsageToday().catch(() => new Map());
  }

  /** Keys for a provider, rotated so successive calls start on different keys. */
  private rotatedKeys(p: ProviderConfig): { key: string; keyId: string }[] {
    const keys = this.deps.keys[p.id] ?? [];
    if (keys.length === 0) return [];
    const start = (this.rr.get(p.id) ?? 0) % keys.length;
    this.rr.set(p.id, start + 1);
    return keys.map((_, i) => {
      const key = keys[(start + i) % keys.length];
      return { key, keyId: this.hashKey(key) };
    });
  }

  async complete<T>(req: CompleteRequest, parse: (text: string) => T): Promise<CompleteResult<T>> {
    await this.ensureLoaded();
    const attempts: AttemptLog[] = [];
    const deadline = req.deadline ?? Infinity;

    for (const provider of this.configuredProviders()) {
      for (const model of provider.models) {
        for (const { key, keyId } of this.rotatedKeys(provider)) {
          const slot: Slot = { provider: provider.id, model: model.name, keyId };
          const sk = slotKey(slot);
          const cd = this.cooldowns!.get(sk);
          if (cd && cd.until > this.now()) {
            attempts.push({ ...slot, outcome: "cooldown", detail: cd.lastError });
            continue;
          }
          if (model.dailyLimit != null && (this.usage!.get(sk) ?? 0) >= model.dailyLimit) {
            attempts.push({ ...slot, outcome: "skipped", detail: "daily limit reached" });
            continue;
          }
          const remaining = deadline - this.now();
          if (remaining < 8_000) {
            attempts.push({ ...slot, outcome: "skipped", detail: "deadline" });
            throw new AllProvidersExhaustedError(attempts);
          }
          const timeoutMs = Math.min(req.timeoutMs ?? 45_000, remaining - 1_000);
          const started = this.now();

          let text: string;
          try {
            text = await this.call(provider, model, key, req, timeoutMs);
          } catch (err) {
            await this.onFailure(slot, err, attempts);
            continue;
          }
          await this.onSuccess(slot);

          try {
            const value = parse(text);
            this.log(`[llm] served by ${provider.id}/${model.name} key=${keyId} in ${this.now() - started}ms`);
            attempts.push({ ...slot, outcome: "ok" });
            return { value, provider: provider.id, model: model.name, keyId, ms: this.now() - started, attempts };
          } catch (parseErr) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            attempts.push({ ...slot, outcome: "invalid", detail: msg.slice(0, 200) });
            // One repair attempt on the same model.
            if (deadline - this.now() < 10_000) continue;
            try {
              const repaired = await this.call(
                provider,
                model,
                key,
                {
                  ...req,
                  user:
                    `${req.user}\n\n---\nYour previous reply could not be used because: ${msg.slice(0, 400)}\n` +
                    `Previous reply (truncated):\n${text.slice(0, 3000)}\n---\n` +
                    `Reply again with ONLY the corrected JSON object, following every rule above.`,
                },
                Math.min(req.timeoutMs ?? 45_000, deadline - this.now() - 1_000),
              );
              await this.recordUsage(slot, true);
              const value = parse(repaired);
              this.log(`[llm] served by ${provider.id}/${model.name} key=${keyId} after repair`);
              attempts.push({ ...slot, outcome: "ok", detail: "after repair" });
              return { value, provider: provider.id, model: model.name, keyId, ms: this.now() - started, attempts };
            } catch (repairErr) {
              const m = repairErr instanceof Error ? repairErr.message : String(repairErr);
              attempts.push({ ...slot, outcome: "invalid", detail: `repair failed: ${m.slice(0, 160)}` });
              if (repairErr instanceof HttpError) await this.onFailure(slot, repairErr, attempts);
            }
          }
        }
      }
    }
    throw new AllProvidersExhaustedError(attempts);
  }

  private async onSuccess(slot: Slot) {
    await this.recordUsage(slot, true);
    const sk = slotKey(slot);
    if (this.cooldowns!.has(sk)) {
      this.cooldowns!.delete(sk);
      await this.deps.store.saveCooldown(slot, null).catch(() => {});
    }
  }

  private async onFailure(slot: Slot, err: unknown, attempts: AttemptLog[]) {
    await this.recordUsage(slot, false);
    const sk = slotKey(slot);
    const prev = this.cooldowns!.get(sk);
    const c = classifyFailure(err, prev?.level ?? 0, this.now());
    const detail = `${c.reason}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`;
    attempts.push({ ...slot, outcome: "error", detail });
    this.log(`[llm] ${slot.provider}/${slot.model} key=${slot.keyId} failed (${detail})`);
    if (c.cooldownUntil != null) {
      const cooldown: Cooldown = { until: c.cooldownUntil, level: c.level, lastError: c.reason };
      this.cooldowns!.set(sk, cooldown);
      await this.deps.store.saveCooldown(slot, cooldown).catch(() => {});
    }
  }

  private async recordUsage(slot: Slot, ok: boolean) {
    const sk = slotKey(slot);
    this.usage!.set(sk, (this.usage!.get(sk) ?? 0) + 1);
    await this.deps.store.recordUsage(slot, ok).catch(() => {});
  }

  private async call(
    provider: ProviderConfig,
    model: ModelConfig,
    key: string,
    req: CompleteRequest,
    timeoutMs: number,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: model.name,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      temperature: req.temperature ?? 0.5,
      max_tokens: req.maxTokens ?? 8192,
      ...(provider.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(model.extra ?? {}),
    };
    const res = await this.fetchImpl(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(provider.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(timeoutMs, 1_000)),
    });
    const raw = await res.text();
    if (!res.ok) {
      const ra = res.headers.get("retry-after");
      const retryAfter = ra && /^\d+(\.\d+)?$/.test(ra) ? Math.ceil(Number(ra)) : null;
      throw new HttpError(res.status, raw, retryAfter);
    }
    let data: { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new HttpError(502, `non-JSON response: ${raw.slice(0, 200)}`, null);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new HttpError(502, `empty completion (finish_reason=${data.choices?.[0]?.finish_reason ?? "?"})`, null);
    }
    return content;
  }
}

/** Short, stable, non-reversible id for a key (FNV-1a, hex). */
export function defaultHash(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** In-memory store, used in tests and as a fallback when the DB is down. */
export class MemoryLlmStore implements LlmStore {
  cooldowns = new Map<string, Cooldown>();
  usage = new Map<string, number>();
  failures = new Map<string, number>();
  async loadCooldowns() {
    return new Map(this.cooldowns);
  }
  async loadUsageToday() {
    return new Map(this.usage);
  }
  async saveCooldown(slot: Slot, c: Cooldown | null) {
    if (c) this.cooldowns.set(slotKey(slot), c);
    else this.cooldowns.delete(slotKey(slot));
  }
  async recordUsage(slot: Slot, ok: boolean) {
    const k = slotKey(slot);
    this.usage.set(k, (this.usage.get(k) ?? 0) + 1);
    if (!ok) this.failures.set(k, (this.failures.get(k) ?? 0) + 1);
  }
}
