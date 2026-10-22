"use client";

import { useSyncExternalStore } from "react";

export interface Settings {
  theme: "dark" | "light";
  fontScale: number;
  snap: boolean;
  voice: string | null;
  rate: number;
}

const DEFAULTS: Settings = { theme: "dark", fontScale: 1, snap: true, voice: null, rate: 1 };
const KEY = "stash-settings";
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

function apply(s: Settings) {
  const d = document.documentElement;
  d.dataset.theme = s.theme;
  d.style.setProperty("--font-scale", String(s.fontScale));
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') ?? (() => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    document.head.appendChild(m);
    return m;
  })();
  meta.setAttribute("content", s.theme === "light" ? "#e6ece7" : "#14110f");
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...read(), ...patch };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
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
