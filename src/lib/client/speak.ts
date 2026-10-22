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

function pickVoice(name: string | null | undefined): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return null;
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
