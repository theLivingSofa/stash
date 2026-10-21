import Parser from "rss-parser";
import type { SourceDef } from "./sources";
import {
  canonicalizeUrl,
  collapse,
  domainOf,
  extractArticle,
  FetchError,
  htmlToText,
  looksPaywalled,
  politeFetch,
  truncateWords,
  words,
} from "./fetch";
import {
  categoryMembers,
  featuredArticleTitle,
  onThisDayTitles,
  parseWikiquoteSummary,
  randomPastDate,
  substantiveRandomTitle,
  wikiExtract,
  wikiUrl,
} from "./wiki";
import { isLowQualityTitle } from "./quality";

export interface Discovered {
  url: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  domain: string;
  publishedAt: string | null;
  inlineText: string | null;
}

const parser = new Parser({ timeout: 8_000 });

const MAX_PER_FEED = 5;
const FULL_TEXT_FEED_MIN_WORDS = 220;

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const wikiItem = (title: string): Discovered => {
  const url = wikiUrl(title);
  return { url, canonicalUrl: canonicalizeUrl(url), title, author: "Wikipedia contributors", domain: "en.wikipedia.org", publishedAt: null, inlineText: null };
};

/** Find new candidate articles from one source. Throws on source failure. */
export async function discover(source: SourceDef, rng: () => number = Math.random): Promise<Discovered[]> {
  switch (source.kind) {
    case "rss":
      return discoverFeed(source);
    case "sep":
      return discoverSep(source, rng);
    case "wiki-category": {
      const titles = await categoryMembers(source.url);
      if (titles.length === 0) throw new Error(`empty category ${source.url}`);
      return shuffle(titles, rng).slice(0, 2).map(wikiItem);
    }
    case "wiki-featured": {
      // Some dates have no featured-feed entry; try a few.
      for (let i = 0; i < 3; i++) {
        const t = await featuredArticleTitle(randomPastDate(rng, Date.UTC(2016, 0, 1))).catch(() => null);
        if (t) return [wikiItem(t)];
      }
      return [];
    }
    case "wiki-onthisday": {
      const titles = await onThisDayTitles(randomPastDate(rng));
      return shuffle(titles, rng).slice(0, 2).map(wikiItem);
    }
    case "wiki-random": {
      const s = await substantiveRandomTitle();
      return s ? [wikiItem(s.title)] : [];
    }
    case "wikiquote":
      return discoverWikiquote(source, rng);
    case "gutenberg":
      return [await gutenbergExcerpt(pick(source.url.split(",").map((s) => s.trim()), rng), rng)];
    case "standard-ebooks":
      return discoverStandardEbooks(source, rng);
  }
}

async function fetchFeed(url: string, skipRobots = false) {
  const page = await politeFetch(url, {
    accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    maxBytes: 15_000_000,
    timeoutMs: 12_000,
    skipRobots,
  });
  return parser.parseString(page.body);
}

async function discoverFeed(source: SourceDef): Promise<Discovered[]> {
  const feed = await fetchFeed(source.url);
  const out: Discovered[] = [];
  for (const item of (feed.items ?? []).slice(0, 25)) {
    if (out.length >= MAX_PER_FEED) break;
    const title = collapse(item.title ?? "");
    if (!title || isLowQualityTitle(title)) continue;
    const html = (item as { "content:encoded"?: string })["content:encoded"] ?? item.content ?? "";
    const link = item.link ?? "";
    let inlineText: string | null = null;

    if (html) {
      const text = htmlToText(html);
      if (words(text) >= FULL_TEXT_FEED_MIN_WORDS && !looksPaywalled(text)) inlineText = text;
    }

    if (!link) continue;
    if (/youtube\.com|youtu\.be|vimeo\.com|\.pdf($|\?)|podcasts?\.|spotify\.com|twitter\.com|x\.com\//i.test(link)) continue;
    if (source.id === "hn-best" && /^(Show|Ask|Launch|Tell) HN/i.test(title)) continue;
    out.push({
      url: link,
      canonicalUrl: canonicalizeUrl(link),
      title,
      author: collapse((item as { creator?: string }).creator ?? (item as { author?: string }).author ?? "") || null,
      domain: domainOf(link),
      publishedAt: item.isoDate ?? null,
      inlineText,
    });
  }
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Wikiquote "Quote of the day" page for a random past date (via the MediaWiki parse API). */
async function discoverWikiquote(source: SourceDef, rng: () => number): Promise<Discovered[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = randomPastDate(rng, Date.UTC(2010, 0, 1));
    const page = `Wikiquote:Quote_of_the_day/${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()},_${d.getUTCFullYear()}`;
    const params = new URLSearchParams({ action: "parse", page, prop: "text", format: "json", formatversion: "2" });
    // Wikimedia API endpoint: governed by the API policy rather than crawler robots.txt.
    const res = await politeFetch(`https://en.wikiquote.org/w/api.php?${params}`, { skipRobots: true, accept: "application/json" });
    let html = "";
    try {
      html = (JSON.parse(res.body) as { parse?: { text?: string } }).parse?.text ?? "";
    } catch {
      continue;
    }
    if (!html) continue;
    const { quote, author } = parseWikiquoteSummary(html);
    if (!quote || words(quote) < 6 || words(quote) > 400) continue;
    let context = "";
    if (author) {
      const ex = await wikiExtract(author).catch(() => null);
      if (ex) context = truncateWords(ex.text, 700);
    }
    const url = `https://en.wikiquote.org/wiki/${page}`;
    return [
      {
        url,
        canonicalUrl: canonicalizeUrl(url),
        title: author ? `A quotation from ${author}` : "Quote of the day",
        author,
        domain: "en.wikiquote.org",
        publishedAt: null,
        inlineText: `Quotation${author ? ` by ${author}` : ""}: "${quote}"${context ? `\n\nAbout ${author} (from Wikipedia):\n${context}` : ""}`,
      },
    ];
  }
  void source;
  return [];
}

const EXCERPT_WORDS = 1_400;

/** Pick a random passage of roughly EXCERPT_WORDS words from the middle 80% of a text. */
export function pickExcerpt(text: string, rng: () => number): { excerpt: string; offset: number } {
  const paras = text.split(/\n\s*\n/).map((p) => collapse(p)).filter((p) => p.length > 0);
  if (paras.length === 0) return { excerpt: "", offset: 0 };
  const lo = Math.floor(paras.length * 0.1);
  const hi = Math.max(lo + 1, Math.floor(paras.length * 0.9));
  let start = lo + Math.floor(rng() * (hi - lo));
  // Back up to a paragraph that looks like the start of a section or a full sentence.
  while (start > lo && !/^[A-Z"“(]/.test(paras[start])) start--;
  const chosen: string[] = [];
  let count = 0;
  for (let i = start; i < paras.length && count < EXCERPT_WORDS; i++) {
    chosen.push(paras[i]);
    count += words(paras[i]);
  }
  return { excerpt: chosen.join("\n\n"), offset: start };
}

function stripGutenbergBoilerplate(raw: string): { title: string | null; author: string | null; body: string } {
  const title = raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const author = raw.match(/^Author:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const start = raw.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  const end = raw.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  let body = raw.slice(start >= 0 ? raw.indexOf("\n", start) + 1 : 0, end > 0 ? end : undefined);
  body = body.replace(/\r\n/g, "\n");
  return { title, author, body };
}

export async function gutenbergExcerpt(id: string, rng: () => number): Promise<Discovered> {
  const url = `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
  const page = await politeFetch(url, { timeoutMs: 15_000, maxBytes: 6_000_000, accept: "text/plain" });
  const { title, author, body } = stripGutenbergBoilerplate(page.body);
  const { excerpt, offset } = pickExcerpt(body, rng);
  if (words(excerpt) < 200) throw new Error(`Gutenberg ${id}: excerpt too short`);
  const bookUrl = `https://www.gutenberg.org/ebooks/${id}`;
  return {
    url: bookUrl,
    canonicalUrl: `${bookUrl}#p${offset}`,
    title: `${title ?? `Gutenberg #${id}`} (excerpt)`,
    author,
    domain: "gutenberg.org",
    publishedAt: null,
    inlineText: excerpt,
  };
}

async function discoverStandardEbooks(source: SourceDef, rng: () => number): Promise<Discovered[]> {
  const feed = await fetchFeed(source.url);
  const items = feed.items ?? [];
  if (items.length === 0) return [];
  const item = pick(items.slice(0, 30), rng);
  const link = item.link;
  if (!link) return [];
  const page = await politeFetch(`${link.replace(/\/$/, "")}/text/single-page`, { timeoutMs: 15_000, maxBytes: 8_000_000 });
  const text = htmlToText(page.body.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, ""));
  const { excerpt, offset } = pickExcerpt(text, rng);
  if (words(excerpt) < 200) throw new Error("Standard Ebooks: excerpt too short");
  return [
    {
      url: link,
      canonicalUrl: `${canonicalizeUrl(link)}#p${offset}`,
      title: `${collapse(item.title ?? "Standard Ebooks")} (excerpt)`,
      author: collapse((item as { author?: string }).author ?? (item as { creator?: string }).creator ?? "") || null,
      domain: "standardebooks.org",
      publishedAt: null,
      inlineText: excerpt,
    },
  ];
}

let sepEntries: string[] | null = null;

async function discoverSep(source: SourceDef, rng: () => number): Promise<Discovered[]> {
  if (!sepEntries) {
    const page = await politeFetch(source.url, { timeoutMs: 15_000, maxBytes: 5_000_000 });
    sepEntries = Array.from(new Set(Array.from(page.body.matchAll(/href="entries\/([a-z0-9-]+)\/?"/g), (m) => m[1])));
  }
  if (sepEntries.length === 0) throw new Error("no SEP entries found");
  const slug = pick(sepEntries, rng);
  const url = `https://plato.stanford.edu/entries/${slug}/`;
  return [{ url, canonicalUrl: canonicalizeUrl(url), title: slug.replace(/-/g, " "), author: null, domain: "plato.stanford.edu", publishedAt: null, inlineText: null }];
}

export interface ArticleText {
  text: string;
  title: string;
  author: string | null;
  canonicalUrl: string | null;
}

export class SkipArticle extends Error {}

/** Resolve the text of a queued article: inline text, Wikipedia API, or fetched page. */
export async function articleText(a: {
  url: string;
  domain: string;
  title: string;
  author: string | null;
  inline_text: string | null;
}): Promise<ArticleText> {
  if (a.inline_text && words(a.inline_text) >= 40) {
    return { text: a.inline_text, title: a.title, author: a.author, canonicalUrl: null };
  }
  if (a.domain === "en.wikipedia.org") {
    const title = decodeURIComponent(new URL(a.url).pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
    const ex = await wikiExtract(title);
    if (!ex || words(ex.text) < 150) throw new SkipArticle("wikipedia article too short");
    return { text: ex.text, title: ex.title, author: "Wikipedia contributors", canonicalUrl: ex.url };
  }
  let page;
  try {
    page = await politeFetch(a.url, { timeoutMs: 9_000 });
  } catch (e) {
    if (e instanceof FetchError) throw new SkipArticle(e.message);
    throw new SkipArticle(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!/html|xml/i.test(page.contentType)) throw new SkipArticle(`not an HTML page (${page.contentType})`);
  const art = extractArticle(page.body, page.url);
  if (!art) throw new SkipArticle("no readable article");
  if (looksPaywalled(art.text)) throw new SkipArticle("paywalled or blocked");
  if (words(art.text) < 250) throw new SkipArticle(`too short (${words(art.text)} words)`);
  return { text: art.text, title: art.title || a.title, author: art.author ?? a.author, canonicalUrl: art.canonicalUrl };
}
