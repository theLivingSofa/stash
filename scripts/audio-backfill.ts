/**
 * Make natural read-aloud audio for every card front that lacks it, within the
 * monthly free budget. Safe to stop and re-run.
 * Usage: NODE_OPTIONS=--network-family-autoselection-attempt-timeout=3000 npm run audio:backfill
 */
import { loadEnv, log } from "./_util";

loadEnv();

(async () => {
  const { backfillAudio } = await import("../src/lib/tts/backfill");
  const hours = Number(process.argv[2] ?? 2);
  const report = await backfillAudio(Date.now() + hours * 3_600_000, (m) => log("audio", m));
  log("audio", JSON.stringify(report));
})();
