"use client";

import { useEffect, useState } from "react";

interface AdminData {
  bufferTarget: number;
  stats: {
    total: number;
    unseen: number;
    seen: number;
    saved: number;
    missing_back: number;
    pending_articles: number;
    by_topic: { topic: string; total: number; unseen: number }[];
  };
  runs: {
    id: number;
    trigger: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    ideas_created: number;
    ideas_rejected: number;
    articles_processed: number;
    sources_polled: number;
    providers: Record<string, number>;
    errors: string[];
  }[];
  usage: { day: string; provider: string; model: string; key_id: string; requests: number; failures: number }[];
  cooldowns: { provider: string; model: string; key_id: string; until: string; level: number; last_error: string | null }[];
  providers: { id: string; label: string; keys: number; models: string[] }[];
  sources: {
    id: string;
    name: string;
    topic: string;
    enabled: boolean;
    last_polled_at: string | null;
    last_ok_at: string | null;
    fail_count: number;
    last_error: string | null;
    articles: number;
    ideas: number;
  }[];
  missingBack: { count: number; sample: { id: string; title: string | null; text: string }[] };
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return `in ${Math.round(-s / 60)} min`;
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export default function AdminPage() {
  const [d, setD] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setD)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <p className="p-6 text-danger">Couldn&apos;t load admin data: {err}</p>;
  if (!d) return <p className="p-6 text-muted">Loading…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const usageToday = d.usage.filter((u) => u.day === today);
  const failing = d.sources.filter((s) => s.fail_count > 0);
  const card = "rounded-2xl border border-line bg-surface p-4";
  const h = "mb-3 text-[15px] font-medium";

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-10 text-[14px]">
      <h1 className="mb-4 px-1 font-serif text-[22px]">Behind the scenes</h1>

      <section className={card}>
        <h2 className={h}>Buffer</h2>
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Unseen", `${d.stats.unseen} / ${d.bufferTarget}`],
            ["Total ideas", d.stats.total],
            ["Seen", d.stats.seen],
            ["Saved", d.stats.saved],
            ["Missing back", d.stats.missing_back],
            ["Queued articles", d.stats.pending_articles],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="font-serif text-[20px]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={`${card} mt-3`}>
        <h2 className={h}>Ideas per topic</h2>
        <ul className="space-y-1.5">
          {d.stats.by_topic.map((t) => (
            <li key={t.topic} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate">{t.topic}</span>
              <span className="h-2 rounded-full" style={{ width: `${Math.max(4, (t.total / Math.max(...d.stats.by_topic.map((x) => x.total))) * 100)}%`, background: `var(--t-${t.topic}, var(--accent))` }} />
              <span className="shrink-0 text-muted">
                {t.unseen}/{t.total}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${card} mt-3`}>
        <h2 className={h}>Recent ingest runs</h2>
        <ul className="space-y-2.5">
          {d.runs.map((r) => (
            <li key={r.id} className="border-b border-line pb-2.5 last:border-0">
              <div className="flex justify-between gap-2">
                <span>
                  {r.trigger} · <span className={r.status === "ok" ? "text-accent" : r.status === "error" ? "text-danger" : "text-muted"}>{r.status}</span>
                </span>
                <span className="text-muted">{ago(r.started_at)}</span>
              </div>
              <div className="text-[13px] text-muted">
                +{r.ideas_created} ideas, {r.ideas_rejected} rejected, {r.articles_processed} articles, {r.sources_polled} sources
                {Object.keys(r.providers ?? {}).length ? ` · ${Object.entries(r.providers).map(([k, v]) => `${k} ×${v}`).join(", ")}` : ""}
              </div>
              {r.errors?.length ? <div className="mt-1 line-clamp-2 text-[12px] text-faint">{r.errors.join(" | ")}</div> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={`${card} mt-3`}>
        <h2 className={h}>AI providers</h2>
        <ul className="space-y-1">
          {d.providers.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span>{p.label}</span>
              <span className="text-muted">{p.keys ? `${p.keys} key${p.keys > 1 ? "s" : ""}` : "no key"}</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 mb-1.5 text-[13px] text-muted">Requests today (UTC)</h3>
        {usageToday.length ? (
          <ul className="space-y-1">
            {usageToday.map((u) => (
              <li key={`${u.provider}${u.model}${u.key_id}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {u.provider}/{u.model}
                </span>
                <span className="shrink-0 text-muted">
                  {u.requests} ({u.failures} failed)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">None yet today.</p>
        )}
        <h3 className="mt-4 mb-1.5 text-[13px] text-muted">Cooling down</h3>
        {d.cooldowns.length ? (
          <ul className="space-y-1">
            {d.cooldowns.map((c) => (
              <li key={`${c.provider}${c.model}${c.key_id}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.provider}/{c.model} ({c.last_error})
                </span>
                <span className="shrink-0 text-muted">until {ago(c.until)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing is cooling down.</p>
        )}
      </section>

      <section className={`${card} mt-3`}>
        <h2 className={h}>Failing sources ({failing.length})</h2>
        {failing.length ? (
          <ul className="space-y-2">
            {failing.map((s) => (
              <li key={s.id}>
                <div className="flex justify-between gap-2">
                  <span>{s.name}</span>
                  <span className="text-danger">{s.fail_count}× failed</span>
                </div>
                <div className="line-clamp-2 text-[12px] text-faint">{s.last_error}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">All sources are healthy.</p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-muted">All {d.sources.length} sources</summary>
          <ul className="mt-2 space-y-1">
            {d.sources.map((s) => (
              <li key={s.id} className="flex justify-between gap-2 text-[13px]">
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-muted">
                  {s.ideas} ideas · {ago(s.last_ok_at)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className={`${card} mt-3`}>
        <h2 className={h}>Ideas missing a back ({d.missingBack.count})</h2>
        {d.missingBack.count ? (
          <ul className="space-y-1">
            {d.missingBack.sample.map((i) => (
              <li key={i.id} className="truncate text-muted">
                {i.title ?? i.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Every idea has its deep dive. Missing ones are written the first time you open them.</p>
        )}
      </section>
    </div>
  );
}
