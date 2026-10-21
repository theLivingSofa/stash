export const TOPICS = [
  { slug: "philosophy", label: "Philosophy", glyph: "Φ" },
  { slug: "history", label: "History", glyph: "◷" },
  { slug: "psychology", label: "Psychology", glyph: "Ψ" },
  { slug: "science", label: "Science", glyph: "⚛" },
  { slug: "economics", label: "Economics", glyph: "∑" },
  { slug: "literature", label: "Literature", glyph: "¶" },
  { slug: "art", label: "Art", glyph: "◐" },
  { slug: "technology", label: "Technology", glyph: "⌘" },
  { slug: "health", label: "Health", glyph: "♡" },
  { slug: "productivity", label: "Productivity", glyph: "◎" },
  { slug: "society", label: "Society", glyph: "⌂" },
  { slug: "religion", label: "Religion & Myth", glyph: "☽" },
  { slug: "language", label: "Language", glyph: "Ꞵ" },
  { slug: "mathematics", label: "Mathematics", glyph: "π" },
  { slug: "nature", label: "Nature", glyph: "❦" },
  { slug: "biography", label: "Biography", glyph: "✎" },
] as const;

export type TopicSlug = (typeof TOPICS)[number]["slug"];

export const TOPIC_SLUGS = TOPICS.map((t) => t.slug) as unknown as readonly TopicSlug[];

const bySlug = new Map<string, (typeof TOPICS)[number]>(TOPICS.map((t) => [t.slug, t]));

export function topicLabel(slug: string): string {
  return bySlug.get(slug)?.label ?? slug.replace(/(^|[-_ ])(\w)/g, (_, s, c) => (s ? " " : "") + c.toUpperCase());
}

export function isTopic(slug: string): slug is TopicSlug {
  return bySlug.has(slug);
}

/** Map loose LLM topic labels onto our canonical slugs. */
const ALIASES: Record<string, TopicSlug> = {
  ethics: "philosophy", logic: "philosophy", metaphysics: "philosophy", epistemology: "philosophy", stoicism: "philosophy",
  politics: "society", sociology: "society", culture: "society", law: "society", anthropology: "society", education: "society",
  neuroscience: "psychology", "cognitive science": "psychology", behavior: "psychology", "behavioral economics": "economics",
  finance: "economics", business: "economics", physics: "science", chemistry: "science", astronomy: "science", biology: "science",
  space: "science", medicine: "health", nutrition: "health", fitness: "health", "mental health": "health",
  computing: "technology", "computer science": "technology", ai: "technology", engineering: "technology", internet: "technology",
  poetry: "literature", fiction: "literature", writing: "literature", books: "literature",
  music: "art", design: "art", architecture: "art", film: "art", painting: "art",
  mythology: "religion", religion: "religion", spirituality: "religion", theology: "religion",
  linguistics: "language", etymology: "language", words: "language",
  math: "mathematics", statistics: "mathematics", geometry: "mathematics",
  ecology: "nature", environment: "nature", animals: "nature", evolution: "nature", climate: "nature", geology: "nature",
  people: "biography", lives: "biography", habits: "productivity", work: "productivity", creativity: "productivity",
  "decision making": "productivity", learning: "productivity",
};

export function normalizeTopic(raw: string): TopicSlug | null {
  const k = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (bySlug.has(k)) return k as TopicSlug;
  if (ALIASES[k]) return ALIASES[k];
  for (const t of TOPICS) if (k.includes(t.slug) || t.label.toLowerCase() === k) return t.slug;
  return null;
}
