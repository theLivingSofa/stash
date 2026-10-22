import { db, must } from "@/lib/db";
import { fail, json, requireOwner } from "@/lib/api";
import { resolveProviders } from "@/lib/llm/config";
import { providerKeys } from "@/lib/llm";
import { BUFFER_TARGET } from "@/lib/feed/chain";

export async function GET() {
  const user = await requireOwner();
  if (!user) return fail(403, "owner only");
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [stats, runs, usage, cooldowns, sources, missing, perSource] = await Promise.all([
    db().rpc("buffer_stats", { p_user: user.id }),
    db().from("ingest_runs").select("*").order("started_at", { ascending: false }).limit(15),
    db().from("llm_usage").select("day, provider, model, key_id, requests, failures").gte("day", since).order("day", { ascending: false }),
    db().from("llm_cooldowns").select("provider, model, key_id, until, level, last_error").gt("until", new Date().toISOString()),
    db().from("sources").select("id, name, kind, topic, enabled, last_polled_at, last_ok_at, fail_count, last_error, items_found").order("fail_count", { ascending: false }),
    db().from("ideas").select("id, title, text", { count: "exact" }).is("back", null).limit(10),
    db().from("articles").select("source_id, status, ideas_count").order("id", { ascending: false }).limit(5000),
  ]);
  const agg = new Map<string, { articles: number; ideas: number; skipped: number }>();
  for (const a of (perSource.data ?? []) as { source_id: string; status: string; ideas_count: number }[]) {
    const e = agg.get(a.source_id) ?? { articles: 0, ideas: 0, skipped: 0 };
    e.articles++;
    e.ideas += a.ideas_count ?? 0;
    if (a.status === "skipped" || a.status === "failed") e.skipped++;
    agg.set(a.source_id, e);
  }
  const keys = providerKeys();
  return json({
    bufferTarget: BUFFER_TARGET,
    stats: must(stats, "buffer_stats"),
    runs: runs.data ?? [],
    usage: usage.data ?? [],
    cooldowns: cooldowns.data ?? [],
    providers: resolveProviders().map((p) => ({ id: p.id, label: p.label, keys: keys[p.id]?.length ?? 0, models: p.models.map((m) => m.name) })),
    sources: (sources.data ?? []).map((s) => ({ ...s, ...(agg.get(s.id as string) ?? { articles: 0, ideas: 0, skipped: 0 }) })),
    missingBack: { count: missing.count ?? 0, sample: missing.data ?? [] },
  });
}
