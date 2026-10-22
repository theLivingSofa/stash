"use client";

import type { Card } from "../types";

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function cardSpeech(card: Card, includeBack: boolean): string {
  const parts = [card.title ? `${card.title}.` : "", card.text];
  if (includeBack && card.back) {
    parts.push(
      "Concept.", card.back.concept,
      "Where it comes from.", card.back.origin,
      "The thinking behind it.", card.back.reasoning,
      "Example.", card.back.example,
    );
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Split into sentence-sized chunks. Long single utterances are unreliable on
 * iOS Safari (and Chrome stops them after ~15s), so we queue short ones.
 */
export function chunkText(text: string, max = 220): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (s.length > max) {
      // A very long sentence: break on commas/spaces.
      let rest = s;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
        const at = cut > max * 0.5 ? cut + 1 : max;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      cur += rest;
    } else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

// Keep references so utterances aren't garbage-collected mid-speech (which
// silently drops their end events in WebKit/Chromium).
let queue: SpeechSynthesisUtterance[] = [];
let session = 0;

// macOS/iOS novelty voices that should never be picked automatically.
const NOVELTY =
  /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Ralph|Kathy|Grandma|Grandpa|Rocko|Shelley|Sandy|Flo|Eddy|Reed)\b/i;

/**
 * How natural a voice is likely to sound (higher is better). Downloaded
 * "Premium"/"Enhanced" voices on iPhone and Mac, Edge's "Natural" voices and
 * Google's voices on Android sound far less robotic than the defaults.
 */
export function voiceScore(v: { name: string; lang: string; localService?: boolean }): number {
  if (!/^en(-|_|$)/i.test(v.lang)) return -100;
  if (NOVELTY.test(v.name)) return -50;
  let s = 0;
  if (/premium/i.test(v.name)) s += 6;
  if (/enhanced/i.test(v.name)) s += 5;
  if (/natural|neural/i.test(v.name)) s += 5;
  if (/siri/i.test(v.name)) s += 4;
  if (/google/i.test(v.name)) s += 3;
  if (/^(Samantha|Ava|Zoe|Evan|Nathan|Allison|Susan|Tom|Karen|Daniel|Moira|Tessa|Serena|Rishi|Veena)\b/i.test(v.name)) s += 1;
  if (/^en[-_](US|GB|IN|AU|IE)/i.test(v.lang)) s += 1;
  return s;
}

/** English voices, most natural first. */
export function rankedVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => voiceScore(v) > -50)
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

function pickVoice(name: string | null | undefined): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v && voiceScore(v) > -50) return v;
  }
  // Automatic: the most natural English voice installed.
  return rankedVoices()[0] ?? null;
}

// Voices load asynchronously (notably on iOS); ask early so the first tap
// can already use the best one.
if (canSpeak()) {
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
  } catch {
    /* ignore */
  }
}

export interface SpeakOptions {
  voice?: string | null;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  /** Called if speech never starts (e.g. iOS muted it). */
  onFail?: () => void;
}

/**
 * Must be called directly inside a tap handler: iOS only allows speech that
 * starts from a user gesture.
 */
export function speak(text: string, opts: SpeakOptions) {
  if (!canSpeak()) {
    opts.onFail?.();
    return;
  }
  const synth = window.speechSynthesis;
  const id = ++session;
  // Only cancel when something is actually queued: on iOS Safari, cancel()
  // immediately followed by speak() can silently drop the new utterance.
  if (synth.speaking || synth.pending) synth.cancel();

  const voice = pickVoice(opts.voice);
  const chunks = chunkText(text);
  let started = false;
  queue = chunks.map((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = voice?.lang ?? "en-US";
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1;
    u.onstart = () => {
      if (!started && id === session) {
        started = true;
        opts.onStart?.();
      }
    };
    if (i === chunks.length - 1) u.onend = () => id === session && opts.onEnd?.();
    u.onerror = (e) => {
      // "interrupted"/"canceled" are normal when the reader stops or switches cards.
      if (id !== session) return;
      if (e.error !== "interrupted" && e.error !== "canceled") opts.onEnd?.();
    };
    return u;
  });
  for (const u of queue) synth.speak(u);
  // iOS can leave the synthesizer paused after the app was backgrounded.
  if (synth.paused) synth.resume();

  window.setTimeout(() => {
    if (id !== session || started || synth.speaking) return;
    synth.cancel();
    opts.onFail?.();
  }, 2500);
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  session++;
  window.speechSynthesis.cancel();
  queue = [];
}
