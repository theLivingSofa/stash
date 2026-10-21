/** Cheap heuristics that run before spending an LLM call. */

const CLICKBAIT = [
  /you won'?t believe/i,
  /\bwill (shock|blow your mind|amaze)\b/i,
  /\bthis one (weird|simple) trick\b/i,
  /\b(best|top) \d+ (deals?|products?|gifts?|apps?)\b/i,
  /^\d+ (things|ways|reasons|tips|signs|habits|foods|products|celebrities)\b/i,
  /\b(sponsored|advertisement|advertorial|promo code|coupon|giveaway|discount|% off|black friday|prime day|cyber monday)\b/i,
  /\b(deal|deals|sale) (alert|of the day)\b/i,
  /\b(webinar|livestream|podcast episode|episode \d+|ep\. ?\d+|open thread|links for|links \d|weekend links|assorted links|friday links)\b/i,
  /\b(job opening|we'?re hiring|call for papers|cfp|conference registration|subscribe to our newsletter)\b/i,
  /\b(horoscope|lottery|celebrity|royal family|box office)\b/i,
];

export function isLowQualityTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 8) return true;
  return CLICKBAIT.some((re) => re.test(t));
}

/** Reject ideas that are empty calories even if the model produced them. */
export function isLowQualityIdea(text: string): boolean {
  const t = text.trim();
  if (t.length < 60) return true;
  if (/\b(click here|subscribe|sign up|buy now|in this article|this article (explains|discusses)|the author (says|argues))\b/i.test(t)) return true;
  if (/^(this|the) (article|post|essay|piece|text|passage)\b/i.test(t)) return true;
  return false;
}

/** Word-trigram shingles for local near-duplicate checks. */
function shingles(text: string): Set<string> {
  const w = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  if (out.size === 0 && w.length) out.add(w.join(" "));
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const DEDUPE = {
  /** pg_trgm similarity above which an idea is treated as a repeat. */
  trigram: 0.6,
  /** Embedding cosine similarity above which an idea is treated as a repeat. */
  cosine: 0.9,
  /** Local shingle overlap within one batch. */
  jaccard: 0.5,
};
