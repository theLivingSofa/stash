"use client";

import type { Card } from "../types";

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function cardSpeech(card: Card, includeBack: boolean): string {
  const parts = [card.title ?? "", card.text];
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

export function speak(text: string, opts: { voice?: string | null; rate?: number; onEnd?: () => void }) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1;
  if (opts.voice) {
    const v = window.speechSynthesis.getVoices().find((x) => x.name === opts.voice);
    if (v) u.voice = v;
  }
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
