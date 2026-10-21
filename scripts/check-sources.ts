/**
 * Test every source in src/lib/ingest/sources.ts against the live web:
 * discovery must work AND a sample article must be readable (or carried in
 * the feed). Prints a table; exits non-zero if any source fails.
 * Usage: npm run sources:check [-- --json]
 */
import "./_util";
import { SOURCES } from "../src/lib/ingest/sources";
import { articleText, discover } from "../src/lib/ingest/discover";
import { words } from "../src/lib/ingest/fetch";

async function check(s: (typeof SOURCES)[number]) {
  const t = Date.now();
  try {
    const items = await discover(s);
    if (items.length === 0) return { id: s.id, ok: false, note: "no items" };
    let sampleWords = 0;
    let lastErr = "";
    for (const it of items.slice(0, 3)) {
      try {
        const a = await articleText({ url: it.url, domain: it.domain, title: it.title, author: it.author, inline_text: it.inlineText });
        sampleWords = words(a.text);
        if (sampleWords > 0) break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (sampleWords === 0) return { id: s.id, ok: false, note: `articles unreadable: ${lastErr.slice(0, 90)}` };
    return { id: s.id, ok: true, note: `${items.length} items, sample ${sampleWords} words, ${Date.now() - t}ms` };
  } catch (e) {
    return { id: s.id, ok: false, note: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
}

async function main() {
  const results: Awaited<ReturnType<typeof check>>[] = [];
  const queue = [...SOURCES];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        results.push(await check(s));
      }
    }),
  );
  results.sort((a, b) => Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id));
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.id.padEnd(40)} ${r.note}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} sources OK`);
  if (process.argv.includes("--json")) console.log(JSON.stringify(failed.map((f) => f.id)));
  process.exit(failed.length ? 1 : 0);
}
main();
