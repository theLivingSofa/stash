import { USER_AGENT, collapse } from "./fetch";

/**
 * Wikipedia / Wikiquote helpers. These use Wikimedia's documented APIs, whose
 * policy (API:Etiquette) allows programmatic access with a descriptive
 * User-Agent; robots.txt applies to crawling rendered pages, which we don't do.
 */

const WIKI = "https://en.wikipedia.org";

async function getJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Api-User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export const wikiUrl = (title: string) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

export interface WikiSummary {
  title: string;
  description: string | null;
  extract: string;
  url: string;
  type: string;
}

export async function wikiSummary(title: string): Promise<WikiSummary | null> {
  try {
    const d = await getJson<{
      title: string;
      type: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    }>(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}?redirect=true`, 6_000);
    if (!d.extract) return null;
    return {
      title: d.title,
      description: d.description ?? null,
      extract: d.extract,
      url: d.content_urls?.desktop?.page ?? wikiUrl(d.title),
      type: d.type,
    };
  } catch {
    return null;
  }
}

/** Best-matching article title for a free-text query (or null). */
export async function wikiSearch(query: string, limit = 1): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(limit),
      srnamespace: "0",
      format: "json",
      formatversion: "2",
    });
    const d = await getJson<{ query?: { search?: { title: string }[] } }>(`${WIKI}/w/api.php?${params}`, 6_000);
    return (d.query?.search ?? []).map((s) => s.title);
  } catch {
    return [];
  }
}

/** Summary for the best match of a concept, skipping disambiguation pages. */
export async function groundConcept(concept: string): Promise<WikiSummary | null> {
  const direct = await wikiSummary(concept);
  if (direct && direct.type === "standard") return direct;
  const [title] = await wikiSearch(concept, 1);
  if (!title) return null;
  const s = await wikiSummary(title);
  return s && s.type === "standard" ? s : null;
}

/** Plain-text body of an article (sections flattened). */
export async function wikiExtract(title: string): Promise<{ title: string; text: string; url: string } | null> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts|info",
    explaintext: "1",
    exsectionformat: "plain",
    inprop: "url",
    redirects: "1",
    titles: title,
    format: "json",
    formatversion: "2",
  });
  const d = await getJson<{ query?: { pages?: { title: string; extract?: string; fullurl?: string; missing?: boolean }[] } }>(
    `${WIKI}/w/api.php?${params}`,
  );
  const page = d.query?.pages?.[0];
  if (!page || page.missing || !page.extract) return null;
  // Drop reference-ish tail sections.
  const text = page.extract.split(/\n(?:See also|References|Notes|Further reading|External links|Bibliography|Sources)\n/)[0];
  return { title: page.title, text: text.trim(), url: page.fullurl ?? wikiUrl(page.title) };
}

const categoryCache = new Map<string, string[]>();

export async function categoryMembers(category: string): Promise<string[]> {
  if (categoryCache.has(category)) return categoryCache.get(category)!;
  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: `Category:${category}`,
    cmtype: "page",
    cmnamespace: "0",
    cmlimit: "500",
    format: "json",
    formatversion: "2",
  });
  const d = await getJson<{ query?: { categorymembers?: { title: string }[] } }>(`${WIKI}/w/api.php?${params}`);
  const titles = (d.query?.categorymembers ?? [])
    .map((m) => m.title)
    .filter((t) => !/^(List of|Lists of|Outline of|Index of|Glossary of|Timeline of)/.test(t));
  categoryCache.set(category, titles);
  return titles;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function randomPastDate(rng: () => number = Math.random, from = Date.UTC(2008, 0, 1)): Date {
  const to = Date.now() - 86_400_000;
  return new Date(from + Math.floor(rng() * (to - from)));
}

export async function featuredArticleTitle(date: Date): Promise<string | null> {
  const d = await getJson<{ tfa?: { titles?: { canonical?: string }; title?: string } }>(
    `${WIKI}/api/rest_v1/feed/featured/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`,
    10_000,
  );
  const t = d.tfa?.titles?.canonical ?? d.tfa?.title;
  return t ? t.replace(/_/g, " ") : null;
}

export async function onThisDayTitles(date: Date): Promise<string[]> {
  const d = await getJson<{ selected?: { text: string; pages?: { titles?: { canonical?: string }; type?: string; extract?: string }[] }[] }>(
    `${WIKI}/api/rest_v1/feed/onthisday/selected/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`,
    10_000,
  );
  const titles: string[] = [];
  for (const ev of d.selected ?? []) {
    // The first page of an event is usually the event itself; skip years/countries.
    const page = (ev.pages ?? []).find((p) => p.type === "standard" && (p.extract?.length ?? 0) > 300);
    const t = page?.titles?.canonical;
    if (t && !/^\d+$/.test(t)) titles.push(t.replace(/_/g, " "));
  }
  return titles;
}

const TRIVIAL =
  /\b(village|hamlet|commune|municipality|township|census|county seat|railway station|metro station|road|highway|footballer|cricketer|basketball|baseball|ice hockey|rugby|athlete|swimmer|cyclist|wrestler|tennis player|politician|album|single|song|ep by|episode|television series|tv series|film|video game|band|rapper|singer|actor|actress|species of|genus of|family of|moth|beetle|snail|fly|spider|asteroid|minor planet|school in|church in|river in|mountain in|island in|lake in|electoral|constituency|airport|stadium|company|newspaper|magazine|radio station|ship|shipwreck)\b/i;

/** A random article that looks substantive (concepts, events, people of note). */
export async function substantiveRandomTitle(maxTries = 8): Promise<WikiSummary | null> {
  for (let i = 0; i < maxTries; i++) {
    try {
      const d = await getJson<{ title: string; type: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } } }>(
        `${WIKI}/api/rest_v1/page/random/summary`,
        6_000,
      );
      const desc = d.description ?? "";
      if (d.type !== "standard" || (d.extract?.length ?? 0) < 500 || TRIVIAL.test(desc) || TRIVIAL.test(d.extract?.slice(0, 200) ?? "")) continue;
      return {
        title: d.title,
        description: desc || null,
        extract: d.extract ?? "",
        url: d.content_urls?.desktop?.page ?? wikiUrl(d.title),
        type: d.type,
      };
    } catch {
      /* retry */
    }
  }
  return null;
}

export interface WikiquoteItem {
  quote: string;
  author: string | null;
  url: string;
  date: string;
}

export function parseWikiquoteSummary(html: string): { quote: string; author: string | null } {
  const text = collapse(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;|&#34;/g, '"')
      .replace(/&#0?39;/g, "'"),
  ).replace(/\s+([,.;:!?)])/g, "$1").replace(/([(“"])\s+/g, "$1");
  const m = text.match(/^(.*?)\s*~\s*(.+?)\s*~?\s*$/);
  if (m) return { quote: m[1].trim(), author: m[2].replace(/~/g, "").trim() || null };
  return { quote: text, author: null };
}
