/** One ingest run locally (debugging). Usage: npm run ingest:local -- [seconds=90] */
import { loadEnv } from "./_util";
import { runIngest } from "../src/lib/ingest/run";

loadEnv();
runIngest({ trigger: "manual", budgetMs: Number(process.argv[2] ?? 90) * 1000, force: true })
  .then((r) => console.log(JSON.stringify(r, null, 1)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
