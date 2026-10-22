import { fail, json } from "@/lib/api";
import { backfillAudio } from "@/lib/tts/backfill";

export const maxDuration = 60;

/** POST /api/tts/backfill (Bearer INGEST_SECRET): make missing card audio for ~45s. */
export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "unauthorized");
  const report = await backfillAudio(Date.now() + 45_000);
  return json(report);
}
