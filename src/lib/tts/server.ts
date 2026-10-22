import "server-only";
import { AwsClient } from "aws4fetch";
import { db } from "../db";

/**
 * Natural read-aloud: Azure neural speech (free F0 tier) makes the audio once,
 * Backblaze B2 keeps it, and every later play streams straight from B2.
 * A monthly character allowance (kept below Azure's free 500k) means this can
 * never bill; past it, the app falls back to the phone's own voice.
 */

const DEFAULT_LIMIT = 450_000;

interface TtsConfig {
  azureKey: string;
  azureRegion: string;
  bucket: string;
  endpoint: string; // e.g. s3.us-west-004.backblazeb2.com
  region: string; // e.g. us-west-004
  s3: AwsClient;
  limit: number;
}

let cached: TtsConfig | null | undefined;

export function ttsConfig(): TtsConfig | null {
  if (cached !== undefined) return cached;
  const env = (k: string) => process.env[k]?.trim() || "";
  const azureKey = env("AZURE_SPEECH_KEY");
  const azureRegion = env("AZURE_SPEECH_REGION").toLowerCase().replace(/\s+/g, "");
  const keyId = env("B2_KEY_ID");
  const appKey = env("B2_APP_KEY");
  const bucket = env("B2_BUCKET");
  const endpoint = env("B2_ENDPOINT").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!azureKey || !azureRegion || !keyId || !appKey || !bucket || !endpoint) return (cached = null);
  const region = endpoint.match(/^s3\.([^.]+)\./)?.[1] ?? "us-west-004";
  const limit = Number(env("TTS_MONTHLY_CHARS")) || DEFAULT_LIMIT;
  cached = {
    azureKey,
    azureRegion,
    bucket,
    endpoint,
    region,
    limit: Math.min(limit, 490_000),
    s3: new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, service: "s3", region }),
  };
  return cached;
}

const objectUrl = (c: TtsConfig, key: string) => `https://${c.endpoint}/${c.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

export async function storedAudio(c: TtsConfig, key: string): Promise<boolean> {
  const res = await c.s3.fetch(objectUrl(c, key), { method: "HEAD" });
  return res.ok;
}

export async function storeAudio(c: TtsConfig, key: string, audio: ArrayBuffer): Promise<void> {
  // Sign, then send the bytes ourselves: passing the signed Request to fetch
  // streams the body without a Content-Length, which B2 rejects (411).
  const signed = await c.s3.sign(objectUrl(c, key), {
    method: "PUT",
    body: audio,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: new Uint8Array(audio) });
  if (!res.ok) throw new Error(`B2 upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** A short-lived signed link the audio element can stream (with seeking) from B2. */
export async function audioLink(c: TtsConfig, key: string, seconds = 3600): Promise<string> {
  const signed = await c.s3.sign(`${objectUrl(c, key)}?X-Amz-Expires=${seconds}`, { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

export async function synthesize(c: TtsConfig, voice: string, text: string): Promise<ArrayBuffer> {
  const lang = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
  const res = await fetch(`https://${c.azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": c.azureKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "stash",
    },
    body: ssml,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Azure speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}

/** Reserve characters from this month's allowance. False when it would go over. */
export async function charge(c: TtsConfig, chars: number): Promise<boolean> {
  const { data, error } = await db().rpc("tts_charge", { p_chars: chars, p_limit: c.limit });
  if (error) throw new Error(`tts_charge: ${error.message}`);
  return data !== null;
}

export async function refund(c: TtsConfig, chars: number): Promise<void> {
  await db().rpc("tts_charge", { p_chars: -chars, p_limit: c.limit });
}

export async function usedThisMonth(): Promise<number> {
  const { data } = await db().rpc("tts_used");
  return Number(data ?? 0);
}
