import { after } from "next/server";
import { fail, json, requireOwner } from "@/lib/api";
import { backfillRunning, pendingAudio, startAudioRound } from "@/lib/tts/backfill";
import { ttsConfig, usedThisMonth } from "@/lib/tts/server";

async function status() {
  const c = ttsConfig();
  const [counts, running, used] = await Promise.all([pendingAudio(), backfillRunning(), usedThisMonth().catch(() => 0)]);
  return { enabled: !!c, ...counts, running, used, limit: c?.limit ?? 0 };
}

/** GET: how many cards have audio; POST: start making audio for the rest (runs on the server). */
export async function GET() {
  if (!(await requireOwner())) return fail(403, "owner only");
  return json(await status());
}

export async function POST(req: Request) {
  if (!(await requireOwner())) return fail(403, "owner only");
  const secret = process.env.INGEST_SECRET;
  if (!secret || !ttsConfig()) return fail(501, "natural voice not set up");
  after(() => startAudioRound(new URL(req.url).origin, secret, 0));
  return json({ started: true, ...(await status()) });
}
