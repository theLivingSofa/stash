import { after } from "next/server";
import { fail, json } from "@/lib/api";
import { backfillAudio, startAudioRound } from "@/lib/tts/backfill";

export const maxDuration = 60;

/** Rounds one chain may run (~40s each), so a started job ends within ~2 hours. */
const MAX_HOPS = 150;

/**
 * POST /api/tts/backfill (Bearer INGEST_SECRET): make missing card audio for
 * ~40s. With ?chain=N it starts the next round itself while cards remain, so
 * a job started from the admin page keeps going without anyone's device.
 */
export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "unauthorized");
  const url = new URL(req.url);
  const hop = Number(url.searchParams.get("chain") ?? NaN);
  // Stop taking new cards at 35s: one slow card must not push the round past
  // the platform's 60s limit, or it is cut off before starting the next round.
  const report = await backfillAudio(Date.now() + 35_000);
  if (Number.isFinite(hop) && hop < MAX_HOPS && report.stopped === "time" && report.remaining > 0) {
    after(() => startAudioRound(url.origin, secret, hop + 1));
  }
  return json(report);
}
