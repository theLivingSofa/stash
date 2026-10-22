import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/lib/llm/config";
import { AllProvidersExhaustedError, classifyFailure, LlmRouter, MemoryLlmStore, slotKey } from "@/lib/llm/router";

const providers: ProviderConfig[] = [
  { id: "gemini", label: "G", baseUrl: "https://g.test", envVar: "G", jsonMode: true, keyUrl: "", models: [{ name: "g-1" }] },
  { id: "groq", label: "Q", baseUrl: "https://q.test", envVar: "Q", jsonMode: true, keyUrl: "", models: [{ name: "q-1" }, { name: "q-2" }] },
];

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
function mockFetch(handler: (url: string, body: { model: string }, key: string) => Reply) {
  const calls: { url: string; model: string; key: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const key = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    calls.push({ url, model: body.model, key });
    const r = handler(url, body, key);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (content: string): Reply => ({ status: 200, body: { choices: [{ message: { content } }] } });
const parseJson = (t: string) => JSON.parse(t) as { ok: boolean };

function router(f: typeof fetch, keys = { gemini: ["gk1", "gk2"], groq: ["qk1"] }, store = new MemoryLlmStore(), now = () => 1_000_000) {
  return { r: new LlmRouter({ providers, keys, store, fetch: f, now, log: () => {}, hashKey: (k) => k }), store };
}

describe("LlmRouter", () => {
  it("uses the first provider when it works", async () => {
    const { f, calls } = mockFetch(() => ok('{"ok":true}'));
    const { r } = router(f);
    const res = await r.complete({ system: "s", user: "u" }, parseJson);
    expect(res.provider).toBe("gemini");
    expect(res.value.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("falls through on 429 and cools the key down", async () => {
    const { f, calls } = mockFetch((url) => (url.startsWith("https://g.test") ? { status: 429, body: "rate limit" } : ok('{"ok":true}')));
    const { r, store } = router(f);
    const res = await r.complete({ system: "s", user: "u" }, parseJson);
    expect(res.provider).toBe("groq");
    expect(calls.filter((c) => c.url.startsWith("https://g.test"))).toHaveLength(2); // both gemini keys tried
    expect(store.cooldowns.get(slotKey({ provider: "gemini", model: "g-1", keyId: "gk1" }))).toBeDefined();
    // Next call skips the cooled-down slots entirely.
    calls.length = 0;
    await r.complete({ system: "s", user: "u" }, parseJson);
    expect(calls.every((c) => c.url.startsWith("https://q.test"))).toBe(true);
  });

  it("rotates keys round-robin across calls", async () => {
    const { f, calls } = mockFetch(() => ok('{"ok":true}'));
    const { r } = router(f);
    await r.complete({ system: "s", user: "u" }, parseJson);
    await r.complete({ system: "s", user: "u" }, parseJson);
    expect(calls.map((c) => c.key)).toEqual(["gk1", "gk2"]);
  });

  it("repairs invalid output once on the same model", async () => {
    let n = 0;
    const { f, calls } = mockFetch(() => (++n === 1 ? ok("not json at all") : ok('{"ok":true}')));
    const { r } = router(f);
    const res = await r.complete({ system: "s", user: "u" }, parseJson);
    expect(res.value.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].model).toBe("g-1");
  });

  it("moves to the next model when repair also fails", async () => {
    const { f } = mockFetch((_u, body) => (body.model === "g-1" ? ok("garbage") : ok('{"ok":true}')));
    const { r } = router(f);
    const res = await r.complete({ system: "s", user: "u" }, parseJson);
    expect(res.provider).toBe("groq");
  });

  it("throws AllProvidersExhaustedError when everything fails", async () => {
    const { f } = mockFetch(() => ({ status: 503, body: "down" }));
    const { r } = router(f);
    await expect(r.complete({ system: "s", user: "u" }, parseJson)).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });

  it("skips providers without keys and respects daily limits", async () => {
    const limited: ProviderConfig[] = [{ ...providers[0], models: [{ name: "g-1", dailyLimit: 1 }] }, providers[1]];
    const { f, calls } = mockFetch(() => ok('{"ok":true}'));
    const store = new MemoryLlmStore();
    const r = new LlmRouter({ providers: limited, keys: { gemini: ["gk1"], groq: ["qk1"] }, store, fetch: f, log: () => {}, hashKey: (k) => k });
    await r.complete({ system: "s", user: "u" }, parseJson);
    const second = await r.complete({ system: "s", user: "u" }, parseJson);
    expect(second.provider).toBe("groq");
    expect(calls).toHaveLength(2);
  });
});

describe("classifyFailure", () => {
  const now = Date.UTC(2026, 9, 22, 12, 0);
  it("daily quota cools down until after UTC midnight", async () => {
    const { f } = mockFetch(() => ({ status: 429, body: "Quota exceeded for metric: generate_requests_per_day" }));
    const store = new MemoryLlmStore();
    const r = new LlmRouter({ providers: [providers[0]], keys: { gemini: ["k"] }, store, fetch: f, log: () => {}, hashKey: (k) => k, now: () => now });
    await expect(r.complete({ system: "s", user: "u" }, JSON.parse)).rejects.toBeInstanceOf(AllProvidersExhaustedError);
    const cd = store.cooldowns.get(slotKey({ provider: "gemini", model: "g-1", keyId: "k" }))!;
    expect(cd.until).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 23, 0, 0));
  });
  it("network errors back off exponentially", () => {
    const a = classifyFailure(new Error("timeout"), 0, now);
    const b = classifyFailure(new Error("timeout"), 3, now);
    expect(b.cooldownUntil! - now).toBeGreaterThan(a.cooldownUntil! - now);
  });
});

describe("exhaustion reason", () => {
  it("reports 'deadline' when the time budget runs out, 'exhausted' when every provider failed", async () => {
    const { f } = mockFetch(() => ({ status: 503, body: "down" }));
    const { r } = router(f);
    const all = await r.complete({ system: "s", user: "u" }, parseJson).catch((e) => e);
    expect(all).toBeInstanceOf(AllProvidersExhaustedError);
    expect(all.reason).toBe("exhausted");
    const { r: r2 } = router(mockFetch(() => ok('{"ok":true}')).f);
    const late = await r2.complete({ system: "s", user: "u", deadline: 1_000_000 + 5_000 }, parseJson).catch((e) => e);
    expect(late.reason).toBe("deadline");
  });
});
