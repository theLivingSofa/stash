/**
 * Run the ingest pipeline locally against the configured (production) database
 * until the unseen buffer reaches a target. Same code path as /api/ingest, but
 * without the serverless time limit.
 *
 * Usage: npm run seed -- [target=300] [minutes=40]
 */
import { loadEnv } from "./_util";
import { runIngest, unseenCount } from "../src/lib/ingest/run";

async function main() {
  loadEnv();
  const target = Number(process.argv[2] ?? 300);
  const minutes = Number(process.argv[3] ?? 40);
  const stopAt = Date.now() + minutes * 60_000;
  let exhaustedStreak = 0;
  while (Date.now() < stopAt) {
    const before = await unseenCount();
    console.log(`[seed] unseen=${before} target=${target}`);
    if (before >= target) break;
    const r = await runIngest({ trigger: "seed", budgetMs: 120_000, force: true });
    console.log(`[seed] run ${r.runId}: ${r.status} +${r.ideasCreated} ideas (rejected ${r.ideasRejected}), articles ${r.articlesProcessed}, found ${r.articlesFound}, providers ${JSON.stringify(r.providers)}`);
    if (r.errors.length) console.log(`[seed] errors:\n  ${r.errors.slice(0, 12).join("\n  ")}`);
    if (r.status === "exhausted") {
      exhaustedStreak++;
      if (exhaustedStreak >= 3) {
        console.log("[seed] all providers exhausted three times in a row; stopping");
        break;
      }
      await new Promise((res) => setTimeout(res, 60_000));
    } else exhaustedStreak = 0;
    if (r.status === "locked") await new Promise((res) => setTimeout(res, 15_000));
  }
  console.log(`[seed] done, unseen=${await unseenCount()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
