/**
 * For every provider with a key: list the models the key can use, then send a
 * tiny JSON request to each configured model. Use it after changing keys or
 * when free model names change. Usage: npm run llm:check
 */
import { loadEnv } from "./_util";
import { resolveProviders } from "../src/lib/llm/config";

async function main() {
  loadEnv();
  for (const p of resolveProviders()) {
    const keys = (process.env[p.envVar] ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) {
      console.log(`\n${p.label}: no key (${p.envVar}); get one at ${p.keyUrl}`);
      continue;
    }
    console.log(`\n${p.label}: ${keys.length} key(s)`);
    try {
      const res = await fetch(`${p.baseUrl}/models`, { headers: { Authorization: `Bearer ${keys[0]}` } });
      const data = (await res.json()) as { data?: { id: string }[] };
      const ids = (data.data ?? []).map((m) => m.id.replace(/^models\//, ""));
      const shown = p.id === "openrouter" ? ids.filter((i) => i.endsWith(":free")) : ids;
      console.log(`  available: ${shown.slice(0, 40).join(", ")}${shown.length > 40 ? ", …" : ""}`);
    } catch (e) {
      console.log(`  could not list models: ${(e as Error).message}`);
    }
    for (const m of p.models) {
      const t = Date.now();
      try {
        const res = await fetch(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys[0]}`, ...(p.headers ?? {}) },
          body: JSON.stringify({
            model: m.name,
            messages: [{ role: "user", content: 'Reply with the JSON {"ok": true}' }],
            max_tokens: 300,
            ...(p.jsonMode ? { response_format: { type: "json_object" } } : {}),
            ...(m.extra ?? {}),
          }),
          signal: AbortSignal.timeout(40_000),
        });
        const body = await res.text();
        console.log(`  ${res.ok ? "OK  " : "FAIL"} ${m.name} (${res.status}, ${Date.now() - t}ms)${res.ok ? "" : ` ${body.slice(0, 140)}`}`);
      } catch (e) {
        console.log(`  FAIL ${m.name}: ${(e as Error).message}`);
      }
    }
  }
}
main();
