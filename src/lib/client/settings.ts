"use client";

import { useSyncExternalStore } from "react";

export type ThemePref = "auto" | "dark" | "light";

export interface Settings {
  /** "auto" follows the device's light/dark setting. */
  theme: ThemePref;
  fontScale: number;
  snap: boolean;
  voice: string | null;
  rate: number;
}

const DEFAULTS: Settings = { theme: "auto", fontScale: 1, snap: true, voice: null, rate: 1 };
const KEY = "stash-settings";
// v2: theme gained "auto" and became the default. Older saved settings always
// carried theme: "dark" (the old default was saved with any change), so they
// move to "auto" once.
const VERSION = 2;
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (saved.v !== VERSION) saved.theme = "auto";
    cache = { ...DEFAULTS, ...saved };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function resolvedTheme(pref: ThemePref): "dark" | "light" {
  if (pref !== "auto") return pref;
  return darkQuery().matches ? "dark" : "light";
}

function apply(s: Settings) {
  const d = document.documentElement;
  const theme = resolvedTheme(s.theme);
  d.dataset.theme = theme;
  d.style.setProperty("--font-scale", String(s.fontScale));
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') ?? (() => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    document.head.appendChild(m);
    return m;
  })();
  meta.setAttribute("content", theme === "light" ? "#e6ece7" : "#14110f");
}

// On "auto", follow the device as it switches (e.g. at sunset).
if (typeof window !== "undefined") {
  darkQuery().addEventListener("change", () => {
    const s = read();
    if (s.theme === "auto") apply(s);
  });
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...read(), ...patch };
  const stored = { ...next, v: VERSION };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* private mode: settings last for this visit */
  }
  apply(next);
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (p: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULTS,
  );
  return [s, updateSettings];
}
