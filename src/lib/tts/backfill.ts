import "server-only";
import { db, must } from "../db";
import { cardSpeech } from "../speech-text";
import { DEFAULT_NATURAL } from "./voices";
import { charge, refund, storeAudio, storedAudio, synthesize, ttsConfig, usedThisMonth } from "./server";

/** Characters kept back each month for on-demand plays (other voices, new cards). */
const RESERVE = 40_000;
/** Azure's free tier allows 20 requests a minute; stay under it. */
const GAP_MS = 3_500;

export const frontKey = (id: string, voice: string = DEFAULT_NATURAL) => `v1/${voice}/${id}-front.mp3`;

export async function markAudioReady(id: string) {
  must(await db().from("ideas").update({ audio_at: new Date().toISOString() }).eq("id", id), "mark audio");
}

export interface BackfillReport {
  made: number;
  found: number;
  failed: number;
  remaining: number;
  stopped: "done" | "time" | "budget" | "off" | "errors" | "busy";
}

const LEASE = "audio-backfill";
const LEASE_SECONDS = 90;

async function takeLease(holder: string): Promise<boolean> {
  const { data, error } = await db().rpc("take_lease", { p_name: LEASE, p_holder: holder, p_seconds: LEASE_SECONDS });
  return !error && data === true;
}

/** Whether a run currently holds the lock (i.e. audio is being made right now). */
export async function backfillRunning(): Promise<boolean> {
  const { data } = await db().from("job_leases").select("until").eq("name", LEASE).maybeSingle();
  return !!data && new Date(data.until as string).getTime() > Date.now();
}

export async function pendingAudio(): Promise<{ ready: number; total: number }> {
  const [{ count: total }, { count: pending }] = await Promise.all([
    db().from("ideas").select("id", { count: "exact", head: true }),
    db().from("ideas").select("id", { count: "exact", head: true }).is("audio_at", null),
  ]);
  return { ready: (total ?? 0) - (pending ?? 0), total: total ?? 0 };
}

/**
 * Make the default voice's front audio for ideas that don't have it yet,
 * newest first, until the deadline or this month's budget (minus a reserve).
 */
export async function backfillAudio(deadline: number, log: (m: string) => void = () => {}): Promise<BackfillReport> {
  const c = ttsConfig();
  const report: BackfillReport = { made: 0, found: 0, failed: 0, remaining: 0, stopped: "done" };
  if (!c) return { ...report, stopped: "off" };
  const budget = c.limit - RESERVE;
  // One runner at a time (schedule, admin button, scripts), renewed per card.
  const holder = crypto.randomUUID();
  if (!(await takeLease(holder))) return { ...report, stopped: "busy" };

  try {
  while (Date.now() < deadline) {
    const rows = must(
      await db().from("ideas").select("id, title, text").is("audio_at", null).order("created_at", { ascending: false }).limit(25),
      "pending audio",
    ) as { id: string; title: string | null; text: string }[];
    if (rows.length === 0) break;
    let progressed = false;
    for (const r of rows) {
      if (Date.now() >= deadline) {
        report.stopped = "time";
        break;
      }
      if (!(await takeLease(holder))) {
        report.stopped = "busy";
        break;
      }
      const key = frontKey(r.id);
      if (await storedAudio(c, key).catch(() => false)) {
        await markAudioReady(r.id);
        report.found++;
        progressed = true;
        continue;
      }
      const text = cardSpeech({ title: r.title, text: r.text, back: null }, false);
      if ((await usedThisMonth()) + text.length > budget || !(await charge(c, text.length))) {
        report.stopped = "budget";
        break;
      }
      const started = Date.now();
      try {
        const audio = await synthesize(c, DEFAULT_NATURAL, text);
        await storeAudio(c, key, audio);
        await markAudioReady(r.id);
        report.made++;
        progressed = true;
        log(`made ${r.id} (${text.length} chars)`);
      } catch (e) {
        await refund(c, text.length).catch(() => {});
        if (/ 429/.test((e as Error).message)) {
          // Free-tier rate limit (another run may be going): pause; it's picked up next pass.
          log("rate limited, pausing");
          await new Promise((res) => setTimeout(res, 20_000));
          continue;
        }
        report.failed++;
        log(`failed ${r.id}: ${(e as Error).message}`);
        if (report.failed >= 5) {
          report.stopped = "errors";
          break;
        }
      }
      const wait = GAP_MS - (Date.now() - started);
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    }
    if (report.stopped !== "done" || !progressed) break;
  }
  } finally {
    await db().rpc("release_lease", { p_name: LEASE, p_holder: holder });
  }
  if (report.stopped === "done" && Date.now() >= deadline) report.stopped = "time";
  const { count } = await db().from("ideas").select("id", { count: "exact", head: true }).is("audio_at", null);
  report.remaining = count ?? 0;
  return report;
}

/** Of these ideas, which have default-voice audio ready. */
export async function audioReady(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db().rpc("audio_ready_ids", { p_ids: ids });
  if (error) return new Set();
  return new Set((data as string[] | null) ?? []);
}

/**
 * Start a round of /api/tts/backfill on the server and let it run on its own;
 * each round starts the next while cards remain (see that route).
 */
export async function startAudioRound(origin: string, secret: string, hop: number) {
  await fetch(`${origin}/api/tts/backfill?chain=${hop}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}
