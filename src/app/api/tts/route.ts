import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, getUser, json } from "@/lib/api";
import { toCard } from "@/lib/feed/chain";
import { getCards } from "@/lib/feed/repo";
import { cardSpeech } from "@/lib/speech-text";
import { audioLink, charge, refund, storeAudio, storedAudio, synthesize, ttsConfig, usedThisMonth } from "@/lib/tts/server";
import { DEFAULT_NATURAL, isNaturalVoice, SAMPLE_TEXT } from "@/lib/tts/voices";

export const maxDuration = 30;

const Query = z.object({
  id: z.union([z.uuid(), z.literal("sample")]),
  part: z.enum(["front", "full"]).default("front"),
  voice: z.string().default(DEFAULT_NATURAL),
});

/**
 * GET /api/tts?status=1 -> { enabled, used, limit }
 * GET /api/tts?id=<idea>&part=front|full&voice=<id> -> redirects to the stored
 * MP3 on Backblaze, making it first (Azure) if this card/voice is new.
 */
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "unauthorized");
  const c = ttsConfig();
  const params = Object.fromEntries(new URL(req.url).searchParams);

  if (params.status) {
    if (!c) return json({ enabled: false, used: 0, limit: 0 });
    const used = await usedThisMonth().catch(() => 0);
    return json({ enabled: used < c.limit - 2_000, used, limit: c.limit });
  }
  if (!c) return fail(501, "natural voice not set up");

  const q = Query.safeParse(params);
  if (!q.success || !isNaturalVoice(q.data.voice)) return fail(400, "bad request");
  const { id, voice } = q.data;

  let text = SAMPLE_TEXT;
  let part = q.data.part;
  if (id !== "sample") {
    const [row] = await getCards(user.id, [id]);
    if (!row) return fail(404, "not found");
    const card = toCard(row, "seen");
    if (!card.back) part = "front";
    text = cardSpeech(card, part === "full");
  }
  const key = `v1/${voice}/${id === "sample" ? "sample" : `${id}-${part}`}.mp3`;

  const redirect = async () => {
    const res = NextResponse.redirect(await audioLink(c, key), 302);
    res.headers.set("Cache-Control", "private, max-age=1800");
    return res;
  };

  if (await storedAudio(c, key).catch(() => false)) return redirect();

  if (!(await charge(c, text.length))) return fail(429, "monthly natural-voice allowance used up");
  let audio: ArrayBuffer;
  try {
    audio = await synthesize(c, voice, text);
  } catch (e) {
    await refund(c, text.length).catch(() => {});
    console.error("[tts]", e);
    return fail(503, "natural voice unavailable");
  }

  try {
    // Store first, then stream from B2: iPhone audio wants a server that can seek.
    await storeAudio(c, key, audio);
    return redirect();
  } catch (e) {
    console.error("[tts] store", e);
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.byteLength), "Cache-Control": "private, max-age=3600" },
    });
  }
}
