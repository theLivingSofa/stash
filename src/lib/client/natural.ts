"use client";

import { DEFAULT_NATURAL } from "../tts/voices";

/**
 * Natural (online) read-aloud: plays the MP3 the server makes once per card and
 * voice. Plain audio playback, so iPhone's Silent mode doesn't mute it and it
 * keeps going with the screen locked.
 */

interface Status {
  enabled: boolean;
  used: number;
  limit: number;
}

let status: Status | null = null;
let loading = false;
let broken = false; // a play failed this session: use the phone's voice instead
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function refreshNaturalStatus() {
  if (loading || typeof window === "undefined") return;
  loading = true;
  fetch("/api/tts?status=1", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((s: Status | null) => {
      status = s;
      emit();
    })
    .catch(() => {})
    .finally(() => {
      loading = false;
    });
}

export function subscribeNatural(cb: () => void) {
  listeners.add(cb);
  if (!status) refreshNaturalStatus();
  return () => {
    listeners.delete(cb);
  };
}

export const naturalStatus = () => status;

/** The natural voice to use now, or null to fall back to the phone's voice. */
export function naturalVoiceFor(): string | null {
  if (broken || !status?.enabled || (typeof navigator !== "undefined" && !navigator.onLine)) return null;
  return DEFAULT_NATURAL;
}

let audio: HTMLAudioElement | null = null;
let session = 0;

export interface NaturalOptions {
  id: string; // idea id, or "sample"
  part: "front" | "full";
  voice: string;
  rate: number;
  title?: string;
  onEnd?: () => void;
  onFail?: () => void;
}

/** Call directly inside the tap handler (iPhone only starts audio from a tap). */
export function playNatural(o: NaturalOptions) {
  const id = ++session;
  audio ??= new Audio();
  const a = audio;
  a.setAttribute("playsinline", "");
  a.preload = "auto";
  a.src = `/api/tts?id=${encodeURIComponent(o.id)}&part=${o.part}&voice=${encodeURIComponent(o.voice)}`;
  a.defaultPlaybackRate = o.rate;
  a.playbackRate = o.rate;
  const fail = () => {
    if (id !== session) return;
    broken = true;
    refreshNaturalStatus();
    o.onFail?.();
  };
  a.onended = () => id === session && o.onEnd?.();
  a.onerror = fail;
  a.onplaying = () => {
    // Some browsers reset the rate when a new source loads.
    if (a.playbackRate !== o.rate) a.playbackRate = o.rate;
  };
  a.play().catch((e: DOMException) => {
    if (e?.name !== "AbortError") fail();
  });
  try {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: o.title || "Stash", artist: "Stash" });
    }
  } catch {
    /* not supported */
  }
}

export function stopNatural() {
  session++;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}
