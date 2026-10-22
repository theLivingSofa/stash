import "server-only";
import { db, must } from "../db";
import { createRouter, embedTexts } from "../llm";
import { AllProvidersExhaustedError, type LlmRouter } from "../llm/router";
import { parseIdeaBatch, type LlmIdea } from "../schemas";
import { normalizeTopic, type TopicSlug } from "../topics";
import { articleText, discover, SkipArticle, type Discovered } from "./discover";
import { canonicalizeUrl, normalizeForHash, sha256, truncateWords, words } from "./fetch";
import { IDEAS_SYSTEM, ideasUserPrompt, type PromptSource } from "./prompt";
import { cosine, DEDUPE, isLowQualityIdea, jaccard } from "./quality";
import { SOURCES, type SourceDef } from "./sources";
import { groundConcept, wikiSearch, wikiUrl } from "./wiki";

/** Keep at least this many unseen ideas ready. */
export const BUFFER_TARGET = 500;
const MAX_SOURCE_WORDS = 1_500;
const ARTICLES_PER_CALL = 2;
const WORKERS = 2;
const MIN_PENDING = 8;
const SOURCES_PER_DISCOVERY = 6;
const LOCK_KEY = "ingest_lock";

export interface IngestOptions {
  trigger: "cron" | "manual" | "feed" | "seed" | "focus";
  budgetMs?: number;
  force?: boolean;
  focusConcept?: string;
  /** Poll this topic's sources now, ignoring their schedules. */
  focusTopic?: string;
}

export interface IngestReport {
  status: "ok" | "locked" | "buffer-full" | "time-limit" | "exhausted" | "error";
  runId?: number;
  unseenBefore: number;
  unseenAfter?: number;
  sourcesPolled: number;
  articlesFound: number;
  articlesProcessed: number;
  ideasCreated: number;
  ideasRejected: number;
  providers: Record<string, number>;
  errors: string[];
  ms: number;
}

interface ArticleRow {
  id: number;
  source_id: string;
  topic: string;
  url: string;
  canonical_url: string;
  title: string;
  author: string | null;
  domain: string;
  inline_text: string | null;
  attempts: number;
}

interface PreparedArticle {
  row: ArticleRow;
  text: string;
  title: string;
  author: string | null;
  sourceUrl: string;
  background: { title: string; extract: string } | null;
}

/** Unseen ideas for the active reader with the fewest left (drives the buffer). */
export async function unseenCount(): Promise<number> {
  return must(await db().rpc("min_active_unseen"), "min_active_unseen") as number;
}

export async function runIngest(opts: IngestOptions): Promise<IngestReport> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 50_000;
  const deadline = started + budget;
  const report: IngestReport = {
    status: "ok",
    unseenBefore: 0,
    sourcesPolled: 0,
    articlesFound: 0,
    articlesProcessed: 0,
    ideasCreated: 0,
    ideasRejected: 0,
    providers: {},
    errors: [],
    ms: 0,
  };

  const locked = must(await db().rpc("try_lock", { p_key: LOCK_KEY, p_ttl_seconds: Math.ceil(budget / 1000) + 30 }), "try_lock");
  if (!locked) {
    report.status = "locked";
    report.ms = Date.now() - started;
    return report;
  }

  let runId: number | undefined;
  try {
    report.unseenBefore = await unseenCount();
    const run = must(
      await db().from("ingest_runs").insert({ trigger: opts.trigger }).select("id").single(),
      "create run",
    ) as { id: number };
    runId = run.id;
    report.runId = runId;

    if (!opts.force && !opts.focusConcept && !opts.focusTopic && report.unseenBefore >= BUFFER_TARGET) {
      report.status = "buffer-full";
      return report;
    }

    await syncSources();
    const router = createRouter();
    if (router.configuredProviders().length === 0) throw new Error("No LLM API keys configured");

    // Concept-focused ingest (used when a filtered feed runs dry).
    const focusIds: number[] = [];
    if (opts.focusConcept) focusIds.push(...(await discoverFocus(opts.focusConcept, report)));

    const { count } = await db().from("articles").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (opts.focusTopic || ((count ?? 0) < MIN_PENDING && deadline - Date.now() > 30_000)) {
      focusIds.push(...(await discoverDue(report, Math.min(deadline, Date.now() + 15_000), opts.focusTopic)));
    }

    let exhausted = false;
    let hitTimeLimit = false;
    let allOut = false;
    const focusQueue = [...focusIds];
    const worker = async () => {
      while (!exhausted && deadline - Date.now() > 25_000) {
        const next = focusQueue.splice(0, ARTICLES_PER_CALL);
        const rows = next.length ? await claimByIds(next) : await claim(ARTICLES_PER_CALL);
        if (rows.length === 0) break;
        try {
          await processBatch(rows, router, report, deadline);
        } catch (e) {
          if (e instanceof AllProvidersExhaustedError) {
            exhausted = true;
            if (e.reason === "deadline") {
              hitTimeLimit = true;
              report.errors.push(`Stopped at the time limit; unfinished articles stay queued. ${e.message}`.slice(0, 300));
            } else {
              allOut = true;
              report.errors.push(e.message.slice(0, 300));
            }
          } else {
            report.errors.push(`batch: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
          }
          await releaseArticles(rows.map((r) => r.id));
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, () => worker()));
    if (allOut) report.status = "exhausted";
    else if (hitTimeLimit) report.status = "time-limit";
  } catch (e) {
    report.status = "error";
    report.errors.push(e instanceof Error ? e.message : String(e));
  } finally {
    report.ms = Date.now() - started;
    report.unseenAfter = await unseenCount().catch(() => undefined);
    if (runId) {
      await db()
        .from("ingest_runs")
        .update({
          status: report.status,
          finished_at: new Date().toISOString(),
          sources_polled: report.sourcesPolled,
          articles_found: report.articlesFound,
          articles_processed: report.articlesProcessed,
          ideas_created: report.ideasCreated,
          ideas_rejected: report.ideasRejected,
          providers: report.providers,
          errors: report.errors.slice(0, 30),
        })
        .eq("id", runId);
    }
    await db().rpc("prune").then(() => {}, () => {});
    await db().rpc("release_lock", { p_key: LOCK_KEY }).then(() => {}, () => {});
  }
  console.log(`[ingest] ${opts.trigger}: ${report.status}, +${report.ideasCreated} ideas in ${report.ms}ms`, report.providers);
  return report;
}

/** Mirror the source config into the DB (health columns are left alone). */
async function syncSources() {
  const rows = SOURCES.map((s) => ({ id: s.id, name: s.name, url: s.url, kind: s.kind, topic: s.topic, enabled: true }));
  await db().from("sources").upsert(rows, { onConflict: "id" });
  const ids = new Set(SOURCES.map((s) => s.id));
  const { data } = await db().from("sources").select("id").eq("enabled", true);
  const stale = (data ?? []).map((r) => r.id as string).filter((id) => !ids.has(id));
  if (stale.length) await db().from("sources").update({ enabled: false }).in("id", stale);
}

interface SourceHealth {
  id: string;
  last_polled_at: string | null;
  fail_count: number;
}

/** Choose sources that are due, favouring topics with the thinnest unseen buffer. */
export function pickDueSources(
  sources: SourceDef[],
  health: Map<string, SourceHealth>,
  unseenByTopic: Map<string, number>,
  n: number,
  now = Date.now(),
  rng: () => number = Math.random,
): SourceDef[] {
  const max = Math.max(1, ...unseenByTopic.values());
  const due = sources.filter((s) => {
    const h = health.get(s.id);
    if (!h?.last_polled_at) return true;
    const backoff = 1 + Math.min(h.fail_count, 6) * 2;
    return now - new Date(h.last_polled_at).getTime() >= (s.everyMin ?? 240) * 60_000 * backoff;
  });
  const scored = due.map((s) => {
    const need = 1 - (unseenByTopic.get(s.topic) ?? 0) / max;
    return { s, score: need + rng() * 0.8 };
  });
  scored.sort((a, b) => b.score - a.score);
  // At most two sources per topic per round, for variety.
  const perTopic = new Map<string, number>();
  const out: SourceDef[] = [];
  for (const { s } of scored) {
    if (out.length >= n) break;
    const c = perTopic.get(s.topic) ?? 0;
    if (c >= 2) continue;
    perTopic.set(s.topic, c + 1);
    out.push(s);
  }
  return out;
}

/** Poll due sources; returns ids of new articles when focusing on a topic (to process first). */
async function discoverDue(report: IngestReport, until: number, focusTopic?: string): Promise<number[]> {
  const { data: healthRows } = await db().from("sources").select("id, last_polled_at, fail_count");
  const health = new Map((healthRows ?? []).map((h) => [h.id as string, h as SourceHealth]));
  const { data: owner } = await db().from("users").select("id").eq("role", "owner").limit(1).maybeSingle();
  const stats = must(await db().rpc("buffer_stats", { p_user: owner?.id ?? null }), "buffer_stats") as {
    by_topic: { topic: string; unseen: number }[];
  };
  const unseenByTopic = new Map(stats.by_topic.map((t) => [t.topic, t.unseen]));
  const chosen = focusTopic
    ? SOURCES.filter((s) => s.topic === focusTopic).sort(() => Math.random() - 0.5).slice(0, 3)
    : pickDueSources(SOURCES, health, unseenByTopic, SOURCES_PER_DISCOVERY);
  const newIds: number[] = [];

  await Promise.all(
    chosen.map(async (source) => {
      const now = new Date().toISOString();
      try {
        const items = await Promise.race([
          discover(source),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("discovery timeout")), Math.max(2_000, until - Date.now()))),
        ]);
        const ids = await insertDiscovered(source, items);
        const inserted = ids.length;
        if (focusTopic) newIds.push(...ids);
        report.articlesFound += inserted;
        report.sourcesPolled++;
        await db()
          .from("sources")
          .update({ last_polled_at: now, last_ok_at: now, fail_count: 0, last_error: null, items_found: inserted, updated_at: now })
          .eq("id", source.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        report.errors.push(`source ${source.id}: ${msg}`.slice(0, 200));
        const { data } = await db().from("sources").select("fail_count").eq("id", source.id).single();
        await db()
          .from("sources")
          .update({ last_polled_at: now, fail_count: ((data?.fail_count as number) ?? 0) + 1, last_error: msg.slice(0, 500), updated_at: now })
          .eq("id", source.id);
      }
    }),
  );
  return newIds;
}

async function insertDiscovered(source: Pick<SourceDef, "id" | "topic">, items: Discovered[]): Promise<number[]> {
  if (items.length === 0) return [];
  const rows = items.map((it) => ({
    source_id: source.id,
    topic: source.topic,
    url: it.url,
    canonical_url: it.canonicalUrl,
    title: it.title.slice(0, 500),
    author: it.author?.slice(0, 200) ?? null,
    domain: it.domain,
    inline_text: it.inlineText,
    published_at: it.publishedAt,
  }));
  const { data, error } = await db()
    .from("articles")
    .upsert(rows, { onConflict: "canonical_url", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`insert articles: ${error.message}`);
  return (data ?? []).map((r) => r.id as number);
}

async function discoverFocus(concept: string, report: IngestReport): Promise<number[]> {
  const titles = await wikiSearch(concept, 3);
  if (titles.length === 0) return [];
  const items: Discovered[] = titles.map((t) => ({
    url: wikiUrl(t),
    canonicalUrl: canonicalizeUrl(wikiUrl(t)),
    title: t,
    author: "Wikipedia contributors",
    domain: "en.wikipedia.org",
    publishedAt: null,
    inlineText: null,
  }));
  await insertDiscovered({ id: "focus", topic: "society" as TopicSlug }, items).catch(() => []);
  const { data } = await db()
    .from("articles")
    .select("id")
    .in("canonical_url", items.map((i) => i.canonicalUrl))
    .eq("status", "pending");
  report.articlesFound += data?.length ?? 0;
  return (data ?? []).map((r) => r.id as number);
}

async function claim(limit: number): Promise<ArticleRow[]> {
  return (must(await db().rpc("claim_articles", { p_limit: limit }), "claim_articles") as ArticleRow[]) ?? [];
}

async function claimByIds(ids: number[]): Promise<ArticleRow[]> {
  const { data } = await db()
    .from("articles")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, source_id, topic, url, canonical_url, title, author, domain, inline_text, attempts");
  return (data ?? []) as ArticleRow[];
}

async function releaseArticles(ids: number[]) {
  if (ids.length === 0) return;
  await db().from("articles").update({ status: "pending", updated_at: new Date().toISOString() }).in("id", ids).eq("status", "processing");
}

async function finishArticle(id: number, status: "done" | "skipped" | "failed", reason: string | null, ideas = 0) {
  await db()
    .from("articles")
    .update({ status, reason: reason?.slice(0, 300) ?? null, ideas_count: ideas, inline_text: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function prepare(row: ArticleRow): Promise<PreparedArticle | null> {
  try {
    const t = await articleText(row);
    const text = truncateWords(t.text, MAX_SOURCE_WORDS);
    const minWords = row.domain === "en.wikiquote.org" ? 8 : 150;
    if (words(text) < minWords) {
      await finishArticle(row.id, "skipped", "too short");
      return null;
    }
    const hash = await sha256(normalizeForHash(text));
    const { error } = await db().from("articles").update({ content_hash: hash }).eq("id", row.id);
    if (error) {
      await finishArticle(row.id, "skipped", /duplicate|unique/i.test(error.message) ? "duplicate content" : error.message);
      return null;
    }
    // Ground non-encyclopedic sources with a Wikipedia summary of their subject.
    let background: PreparedArticle["background"] = null;
    if (row.domain !== "en.wikipedia.org") {
      const g = await groundConcept(t.title.replace(/\(excerpt\)$/i, "").slice(0, 120)).catch(() => null);
      if (g) background = { title: g.title, extract: g.extract.slice(0, 1_200) };
    }
    return { row, text, title: t.title || row.title, author: t.author, sourceUrl: t.canonicalUrl ?? row.url, background };
  } catch (e) {
    const reason = e instanceof SkipArticle ? e.message : `error: ${e instanceof Error ? e.message : String(e)}`;
    await finishArticle(row.id, row.attempts >= 3 || e instanceof SkipArticle ? "skipped" : "failed", reason);
    return null;
  }
}

async function processBatch(rows: ArticleRow[], router: LlmRouter, report: IngestReport, deadline: number) {
  const prepared = (await Promise.all(rows.map(prepare))).filter((p): p is PreparedArticle => p !== null);
  if (prepared.length === 0) return;

  const sources: PromptSource[] = prepared.map((p, i) => ({
    index: i + 1,
    title: p.title,
    author: p.author,
    domain: p.row.domain,
    text: p.text,
    background: p.background,
  }));

  const result = await router.complete(
    { system: IDEAS_SYSTEM, user: ideasUserPrompt(sources), deadline, maxTokens: 8_000, temperature: 0.5 },
    parseIdeaBatch,
  );
  const providerKey = `${result.provider}/${result.model}`;
  report.providers[providerKey] = (report.providers[providerKey] ?? 0) + 1;
  report.ideasRejected += result.value.rejected.length;

  const created = await storeIdeas(prepared, result.value.ideas, providerKey, report);
  const perArticle = new Map<number, number>();
  for (const c of created) perArticle.set(c, (perArticle.get(c) ?? 0) + 1);
  for (const p of prepared) {
    const n = perArticle.get(p.row.id) ?? 0;
    await finishArticle(p.row.id, "done", n === 0 ? "no ideas kept" : null, n);
    report.articlesProcessed++;
  }
}

/** Filter, dedupe, ground and insert ideas. Returns the article id for each idea stored. */
async function storeIdeas(prepared: PreparedArticle[], ideas: LlmIdea[], providerKey: string, report: IngestReport): Promise<number[]> {
  const [provider, ...modelParts] = providerKey.split("/");
  const model = modelParts.join("/");
  const kept: { idea: LlmIdea; article: PreparedArticle }[] = [];
  for (const idea of ideas) {
    const article = prepared[idea.source_index - 1] ?? prepared[0];
    if (isLowQualityIdea(idea.text)) {
      report.ideasRejected++;
      continue;
    }
    if (kept.some((k) => jaccard(k.idea.text, idea.text) > DEDUPE.jaccard)) {
      report.ideasRejected++;
      continue;
    }
    kept.push({ idea, article });
  }
  if (kept.length === 0) return [];

  const embeddings = await embedTexts(kept.map((k) => `${k.idea.title ?? ""}. ${k.idea.text}`));

  // Semantic duplicates within this batch.
  const survivors: { idea: LlmIdea; article: PreparedArticle; embedding: number[] | null }[] = [];
  kept.forEach((k, i) => {
    const e = embeddings?.[i] ?? null;
    if (e && survivors.some((s) => s.embedding && cosine(s.embedding, e) > DEDUPE.cosine)) {
      report.ideasRejected++;
      return;
    }
    survivors.push({ ...k, embedding: e });
  });

  const out: number[] = [];
  await Promise.all(
    survivors.map(async ({ idea, article, embedding }) => {
      const { data: sim } = await db().rpc("similar_ideas", {
        p_text: idea.text,
        p_embedding: embedding ? JSON.stringify(embedding) : null,
      });
      const s = (sim as { max_trgm: number; max_cosine: number }[] | null)?.[0];
      if (s && (s.max_trgm > DEDUPE.trigram || s.max_cosine > DEDUPE.cosine)) {
        report.ideasRejected++;
        return;
      }
      const topics = Array.from(
        new Set(idea.topics.map(normalizeTopic).filter((t): t is TopicSlug => t !== null)),
      ).slice(0, 3);
      if (topics.length === 0) topics.push(article.row.topic as TopicSlug);

      let learnMore: string | null = null;
      if (idea.main_concept) {
        const g = await groundConcept(idea.main_concept).catch(() => null);
        if (g) learnMore = g.url;
      }
      if (!learnMore && article.row.domain === "en.wikipedia.org") learnMore = article.sourceUrl;

      const { error } = await db()
        .from("ideas")
        .insert({
          article_id: article.row.id,
          title: idea.title || null,
          text: idea.text,
          topics,
          why_it_matters: idea.why_it_matters || null,
          main_concept: idea.main_concept || null,
          back: idea.back,
          learn_more_url: learnMore,
          source_title: article.title.slice(0, 300),
          source_author: article.author,
          source_url: article.sourceUrl,
          source_domain: article.row.domain,
          provider,
          model,
          embedding: embedding ? JSON.stringify(embedding) : null,
        });
      if (error) {
        report.errors.push(`insert idea: ${error.message}`.slice(0, 200));
        return;
      }
      report.ideasCreated++;
      out.push(article.row.id);
    }),
  );
  return out;
}
