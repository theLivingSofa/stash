import type { TopicSlug } from "../topics";

/**
 * Content sources. To add one, append an entry and run `npm run sources:check`
 * to confirm it responds; failing sources are non-fatal at runtime (they are
 * recorded on /admin and skipped), but dead ones should be removed here.
 *
 * kinds:
 *   rss              RSS/Atom feed. Article pages are fetched with Readability
 *                    unless the feed already carries the full text.
 *   wiki-category    Random page from a Wikipedia category (evergreen concepts).
 *   wiki-featured    Wikipedia "Today's featured article" for a random past date.
 *   wiki-onthisday   Pages linked from Wikipedia's "On this day" for a random date.
 *   wiki-random      Random Wikipedia article, filtered for substance.
 *   wikiquote        Wikiquote quote of the day feed.
 *   gutenberg        Random excerpt from a public-domain classic (Project Gutenberg id).
 *   standard-ebooks  Random excerpt from a Standard Ebooks release (via its feed).
 *   sep              Random entry from the Stanford Encyclopedia of Philosophy contents
 *                    page (its RSS feed is disallowed by robots.txt; entries are allowed).
 *
 * Removed after live testing (2026-10-22): Reddit (robots.txt + 429s), Lobsters,
 * Science-Based Medicine (robots.txt), Ars Technica, Knowable, Merriam-Webster,
 * NIH News in Health (403 to automated readers), plus several dead feeds.
 */
export type SourceKind =
  | "rss"
  | "wiki-category"
  | "wiki-featured"
  | "wiki-onthisday"
  | "wiki-random"
  | "wikiquote"
  | "gutenberg"
  | "standard-ebooks"
  | "sep";

export interface SourceDef {
  id: string;
  name: string;
  kind: SourceKind;
  topic: TopicSlug;
  /** Feed URL, category title, or comma-separated Gutenberg ids. */
  url: string;
  /** Minutes between polls (feeds update slowly; generators can run often). */
  everyMin?: number;
}

const rss = (id: string, name: string, topic: TopicSlug, url: string, everyMin = 240): SourceDef => ({
  id, name, kind: "rss", topic, url, everyMin,
});
const wikiCat = (topic: TopicSlug, category: string): SourceDef => ({
  id: `wikicat-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `Wikipedia: ${category}`,
  kind: "wiki-category",
  topic,
  url: category,
  everyMin: 20,
});

export const SOURCES: SourceDef[] = [
  // ---- Open / evergreen ----
  { id: "wiki-featured", name: "Wikipedia featured article", kind: "wiki-featured", topic: "history", url: "https://en.wikipedia.org/api/rest_v1/feed/featured", everyMin: 10 },
  { id: "wiki-onthisday", name: "Wikipedia: On this day", kind: "wiki-onthisday", topic: "history", url: "https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected", everyMin: 15 },
  { id: "wiki-random", name: "Wikipedia random article", kind: "wiki-random", topic: "science", url: "https://en.wikipedia.org/api/rest_v1/page/random/summary", everyMin: 15 },
  { id: "wikiquote-qotd", name: "Wikiquote quote of the day", kind: "wikiquote", topic: "literature", url: "https://en.wikiquote.org/w/api.php?action=featuredfeed&feed=qotd&feedformat=atom", everyMin: 720 },
  { id: "sep", name: "Stanford Encyclopedia of Philosophy", kind: "sep", topic: "philosophy", url: "https://plato.stanford.edu/contents.html", everyMin: 30 },
  {
    id: "gutenberg-philosophy", name: "Project Gutenberg: philosophy", kind: "gutenberg", topic: "philosophy", everyMin: 30,
    url: "2680,1497,8438,5827,4363,1998,3600,10741,10715,9105,18269,575,9662,3800,14328,45109,1656",
  },
  {
    id: "gutenberg-society", name: "Project Gutenberg: society & economics", kind: "gutenberg", topic: "society", everyMin: 60,
    url: "34901,3207,1232,7370,147,71,3300,2130",
  },
  {
    id: "gutenberg-science", name: "Project Gutenberg: science & nature", kind: "gutenberg", topic: "science", everyMin: 60,
    url: "1228,2300,14474,201,1408,1887,32540,205",
  },
  {
    id: "gutenberg-lives", name: "Project Gutenberg: lives & conduct", kind: "gutenberg", topic: "biography", everyMin: 60,
    url: "20203,674,1564,1091,25326,2274,935,37134",
  },
  {
    id: "gutenberg-myth", name: "Project Gutenberg: myth & religion", kind: "gutenberg", topic: "religion", everyMin: 60,
    url: "4928,3623,621,58585",
  },
  { id: "standard-ebooks", name: "Standard Ebooks", kind: "standard-ebooks", topic: "literature", url: "https://standardebooks.org/feeds/atom/new-releases", everyMin: 120 },

  // ---- Wikipedia categories (evergreen concepts, by topic) ----
  wikiCat("philosophy", "Thought experiments"),
  wikiCat("philosophy", "Philosophical arguments"),
  wikiCat("philosophy", "Concepts in epistemology"),
  wikiCat("philosophy", "Concepts in ethics"),
  wikiCat("philosophy", "Informal fallacies"),
  wikiCat("philosophy", "Philosophy of mind"),
  wikiCat("psychology", "Cognitive biases"),
  wikiCat("psychology", "Psychological effects"),
  wikiCat("psychology", "Psychological theories"),
  wikiCat("psychology", "Heuristics"),
  wikiCat("psychology", "Optical illusions"),
  wikiCat("economics", "Economic theories"),
  wikiCat("economics", "Economics laws"),
  wikiCat("economics", "Game theory"),
  wikiCat("economics", "Economic history"),
  wikiCat("mathematics", "Mathematical paradoxes"),
  wikiCat("mathematics", "Unsolved problems in mathematics"),
  wikiCat("mathematics", "Theorems in probability theory"),
  wikiCat("mathematics", "Statistical paradoxes"),
  wikiCat("science", "Physical paradoxes"),
  wikiCat("science", "Scientific laws"),
  wikiCat("science", "Unsolved problems in physics"),
  wikiCat("science", "Evolutionary biology concepts"),
  wikiCat("language", "Figures of speech"),
  wikiCat("language", "Rhetorical techniques"),
  wikiCat("language", "Linguistic error"),
  wikiCat("language", "Etymology"),
  wikiCat("language", "Semantics"),
  wikiCat("language", "Pragmatics"),
  wikiCat("literature", "Narrative techniques"),
  wikiCat("literature", "Literary concepts"),
  wikiCat("art", "Art movements"),
  wikiCat("art", "Composition in visual art"),
  wikiCat("art", "Art history"),
  wikiCat("art", "Renaissance artists"),
  wikiCat("technology", "Software engineering folklore"),
  wikiCat("technology", "History of computing"),
  wikiCat("technology", "Inventions"),
  wikiCat("productivity", "Adages"),
  wikiCat("productivity", "Time management"),
  wikiCat("productivity", "Habits"),
  wikiCat("society", "Social concepts"),
  wikiCat("society", "Political philosophy"),
  wikiCat("religion", "Comparative mythology"),
  wikiCat("religion", "Greek mythology"),
  wikiCat("religion", "Mythological archetypes"),
  wikiCat("religion", "Norse mythology"),
  wikiCat("religion", "Hindu mythology"),
  wikiCat("religion", "Egyptian mythology"),
  wikiCat("religion", "Philosophy of religion"),
  wikiCat("religion", "Buddhist philosophy"),
  wikiCat("nature", "Ecology"),
  wikiCat("nature", "Ethology"),
  wikiCat("nature", "Ecological processes"),
  wikiCat("history", "Historiography"),
  wikiCat("history", "Ancient history"),
  wikiCat("health", "Sleep"),
  wikiCat("health", "Human nutrition"),
  wikiCat("health", "Exercise physiology"),
  wikiCat("health", "Epidemiology"),
  wikiCat("health", "Medical ethics"),
  wikiCat("health", "Stress (biological and psychological)"),
  wikiCat("biography", "Philosophers of science"),
  wikiCat("biography", "Nobel laureates in Physics"),
  wikiCat("biography", "Ancient Greek mathematicians"),

  // ---- Philosophy ----
  rss("aeon", "Aeon", "philosophy", "https://aeon.co/feed.rss"),
  rss("psyche", "Psyche", "psychology", "https://psyche.co/feed.rss"),
  rss("1000wordphil", "1000-Word Philosophy", "philosophy", "https://1000wordphilosophy.com/feed/", 720),
  rss("dailynous", "Daily Nous", "philosophy", "https://dailynous.com/feed/", 720),
  rss("philosophynow", "Philosophy Now", "philosophy", "https://philosophynow.org/rss", 720),
  rss("noema", "Noema", "society", "https://www.noemamag.com/feed/"),

  // ---- History ----
  rss("smithsonian-history", "Smithsonian: History", "history", "https://www.smithsonianmag.com/rss/history/"),
  rss("historytoday", "History Today", "history", "https://www.historytoday.com/feed/rss.xml"),
  rss("historyextra", "HistoryExtra", "history", "https://www.historyextra.com/feed/"),
  rss("worldhistory", "World History Encyclopedia", "history", "https://www.worldhistory.org/rss/"),
  rss("pdr", "The Public Domain Review", "art", "https://publicdomainreview.org/rss.xml", 720),
  rss("jstor-daily", "JSTOR Daily", "history", "https://daily.jstor.org/feed/"),
  rss("antigone", "Antigone", "history", "https://antigonejournal.com/feed/", 720),

  // ---- Psychology ----
  rss("acx", "Astral Codex Ten", "psychology", "https://www.astralcodexten.com/feed", 720),
  rss("greatergood", "Greater Good Magazine", "psychology", "https://greatergood.berkeley.edu/site/rss/articles"),

  // ---- Science ----
  rss("quanta", "Quanta Magazine", "science", "https://www.quantamagazine.org/feed/"),
  rss("nautilus", "Nautilus", "science", "https://nautil.us/feed/"),
  rss("bigthink", "Big Think", "science", "https://bigthink.com/feed/"),
  rss("sciencenews", "Science News", "science", "https://www.sciencenews.org/feed"),
  rss("asterisk", "Asterisk", "science", "https://asteriskmag.com/feed", 720),
  rss("conversation", "The Conversation", "society", "https://theconversation.com/global/articles.atom"),
  rss("thereader", "The MIT Press Reader", "society", "https://thereader.mitpress.mit.edu/feed/"),

  // ---- Economics ----
  rss("marginalrevolution", "Marginal Revolution", "economics", "https://marginalrevolution.com/feed"),
  rss("noahpinion", "Noahpinion", "economics", "https://www.noahpinion.blog/feed"),
  rss("libertystreet", "Liberty Street Economics", "economics", "https://libertystreeteconomics.newyorkfed.org/feed/", 720),
  rss("econlib", "Econlib", "economics", "https://www.econlib.org/feed/"),
  rss("worksinprogress", "Works in Progress", "economics", "https://worksinprogress.co/rss.xml", 720),

  // ---- Literature ----
  rss("marginalian", "The Marginalian", "literature", "https://www.themarginalian.org/feed/"),
  rss("lithub", "Literary Hub", "literature", "https://lithub.com/feed/"),
  rss("parisreview", "The Paris Review Daily", "literature", "https://www.theparisreview.org/blog/feed/"),
  rss("openculture", "Open Culture", "art", "https://www.openculture.com/feed"),

  // ---- Art ----
  rss("colossal", "Colossal", "art", "https://www.thisiscolossal.com/feed/"),
  rss("smithsonian-arts", "Smithsonian: Arts & Culture", "art", "https://www.smithsonianmag.com/rss/arts-culture/"),

  // ---- Technology ----
  rss("hn-best", "Hacker News (best)", "technology", "https://hnrss.org/best?points=250", 120),
  rss("pg-essays", "Paul Graham essays", "technology", "http://www.aaronsw.com/2002/feeds/pgessays.rss", 1440),
  rss("simonw", "Simon Willison", "technology", "https://simonwillison.net/atom/entries/"),
  rss("danluu", "Dan Luu", "technology", "https://danluu.com/atom.xml", 1440),
  rss("mit-techreview", "MIT Technology Review", "technology", "https://www.technologyreview.com/feed/"),

  // ---- Health ----
  rss("sciencedaily-health", "ScienceDaily: Health", "health", "https://www.sciencedaily.com/rss/health_medicine.xml"),
  rss("nutritionfacts", "NutritionFacts.org", "health", "https://nutritionfacts.org/feed/"),
  rss("attia", "Peter Attia", "health", "https://peterattiamd.com/feed/", 720),
  rss("kff", "KFF Health News", "health", "https://kffhealthnews.org/feed/"),

  // ---- Productivity ----
  rss("fs-blog", "Farnam Street", "productivity", "https://fs.blog/feed/"),
  rss("calnewport", "Cal Newport", "productivity", "https://calnewport.com/feed/"),
  rss("jamesclear", "James Clear", "productivity", "https://jamesclear.com/feed"),
  rss("nesslabs", "Ness Labs", "productivity", "https://nesslabs.com/feed"),
  rss("raptitude", "Raptitude", "productivity", "https://www.raptitude.com/feed/"),

  // ---- Society ----
  rss("owid", "Our World in Data", "society", "https://ourworldindata.org/atom.xml", 720),
  rss("pew", "Pew Research Center", "society", "https://www.pewresearch.org/feed/"),

  // ---- Language ----
  rss("languagelog", "Language Log", "language", "https://languagelog.ldc.upenn.edu/nll/?feed=rss2"),
  rss("grammarphobia", "Grammarphobia", "language", "https://www.grammarphobia.com/blog/feed"),

  // ---- Mathematics ----
  rss("terrytao", "Terence Tao", "mathematics", "https://terrytao.wordpress.com/feed/", 720),
  rss("johndcook", "John D. Cook", "mathematics", "https://www.johndcook.com/blog/feed/"),
  rss("mathbaddrawings", "Math with Bad Drawings", "mathematics", "https://mathwithbaddrawings.com/feed/", 720),
  rss("plusmaths", "Plus Magazine", "mathematics", "https://plus.maths.org/content/rss.xml", 720),

  // ---- Nature ----
  rss("mongabay", "Mongabay", "nature", "https://news.mongabay.com/feed/"),
  rss("smithsonian-nature", "Smithsonian: Science & Nature", "nature", "https://www.smithsonianmag.com/rss/science-nature/"),
  rss("hakai", "Hakai Magazine", "nature", "https://hakaimagazine.com/feed/"),
  rss("atlasobscura", "Atlas Obscura", "nature", "https://www.atlasobscura.com/feeds/latest"),
];
