import robotsParser from "robots-parser";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

export const BOT_NAME = "StashBot";
export const USER_AGENT = `Mozilla/5.0 (compatible; ${BOT_NAME}/1.0; +https://github.com/theLivingSofa/stash)`;

export class FetchError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

type Robots = ReturnType<typeof robotsParser>;
const robotsCache = new Map<string, Promise<Robots | null>>();

async function loadRobots(origin: string): Promise<Robots | null> {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5_000),
      redirect: "follow",
    });
    if (res.status >= 400 && res.status < 500) return null; // no robots.txt => allowed
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 200_000);
    return robotsParser(robotsUrl, body);
  } catch {
    return null; // unreachable robots.txt: treat as allowed (standard behaviour)
  }
}

export async function allowedByRobots(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  if (!robotsCache.has(origin)) robotsCache.set(origin, loadRobots(origin));
  const robots = await robotsCache.get(origin)!;
  if (!robots) return true;
  return robots.isAllowed(url, BOT_NAME) !== false;
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/** GET with UA, timeout, robots.txt check and a response size cap. */
export async function politeFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; accept?: string; skipRobots?: boolean } = {},
): Promise<FetchedPage> {
  const { timeoutMs = 8_000, maxBytes = 3_000_000, accept, skipRobots = false } = opts;
  if (!skipRobots && !(await allowedByRobots(url))) throw new FetchError(`blocked by robots.txt: ${url}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} for ${url}`, res.status);
  const body = await readCapped(res, maxBytes);
  return { url: res.url || url, status: res.status, contentType: res.headers.get("content-type") ?? "", body };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, buf.length - off)), off);
    off += c.byteLength;
    if (off >= buf.length) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_src|cmpid|smid|source$|rss$|via$)/i;

/** Normalise a URL for dedupe: https, no hash, no tracking params, no trailing slash. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.protocol === "http:") u.protocol = "https:";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function htmlToText(html: string): string {
  if (!html) return "";
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  document.querySelectorAll("script,style,noscript,figure figcaption,iframe").forEach((n) => n.remove());
  const blocks = Array.from(document.querySelectorAll("p,li,blockquote,h1,h2,h3,h4,pre"));
  const text = blocks.length > 0 ? blocks.map((b) => collapse(b.textContent ?? "")).filter(Boolean).join("\n\n") : collapse(document.body?.textContent ?? "");
  return text;
}

const PAYWALL = [
  /subscribe (now )?to (continue|keep) reading/i,
  /this (article|content|story) is (only )?(available )?(for|to) (paid )?subscribers/i,
  /already a subscriber\?/i,
  /to continue reading,? (please )?(log ?in|sign ?in|subscribe)/i,
  /you('ve| have) reached your (free )?(article )?limit/i,
  /become a member to (read|unlock)/i,
  /please enable javascript/i,
  /access denied|are you a robot|verify you are human|just a moment\.\.\./i,
];

export interface ExtractedArticle {
  title: string;
  author: string | null;
  text: string;
  canonicalUrl: string | null;
  siteName: string | null;
}

/** Mozilla Readability over linkedom. Returns null if no article is found. */
export function extractArticle(html: string, url: string): ExtractedArticle | null {
  const { document } = parseHTML(html);
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
  const metaAuthor =
    document.querySelector('meta[name="author"]')?.getAttribute("content") ??
    document.querySelector('meta[property="article:author"]')?.getAttribute("content") ??
    null;
  let parsed: { title?: string | null; byline?: string | null; content?: string | null; textContent?: string | null; siteName?: string | null } | null = null;
  try {
    // linkedom's document is close enough to the DOM Readability expects.
    parsed = new Readability(document as unknown as Document, { charThreshold: 400 }).parse();
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  const text = parsed.content ? htmlToText(parsed.content) : collapse(parsed.textContent ?? "");
  let canonicalUrl: string | null = null;
  if (canonical) {
    try {
      canonicalUrl = new URL(canonical, url).toString();
    } catch {
      canonicalUrl = null;
    }
  }
  return {
    title: collapse(parsed.title ?? ""),
    author: cleanAuthor(parsed.byline ?? metaAuthor),
    text,
    canonicalUrl,
    siteName: parsed.siteName ?? null,
  };
}

function cleanAuthor(a: string | null | undefined): string | null {
  if (!a) return null;
  const s = collapse(a).replace(/^by\s+/i, "");
  if (!s || s.length > 80 || /^https?:/.test(s)) return null;
  return s;
}

export function looksPaywalled(text: string): boolean {
  const head = text.slice(0, 4000);
  return PAYWALL.some((re) => re.test(head));
}

export const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Keep at most `max` words, cutting at a paragraph or sentence boundary when possible. */
export function truncateWords(text: string, max: number): string {
  const parts = text.split(/(\s+)/);
  let count = 0;
  let out = "";
  for (const p of parts) {
    if (/\S/.test(p)) count++;
    if (count > max) break;
    out += p;
  }
  if (count <= max) return text;
  const lastStop = Math.max(out.lastIndexOf(". "), out.lastIndexOf(".\n"));
  return lastStop > out.length * 0.7 ? out.slice(0, lastStop + 1) : out;
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 6000);
}
