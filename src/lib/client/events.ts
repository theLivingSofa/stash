"use client";

import type { EventKind } from "../types";

/** Batches interaction events; flushes every few seconds and when the page hides. */
type Ev = { id: string; kind: EventKind };
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const PENDING_KEY = "stash-pending-events";

function persist() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

export function track(id: string, kind: EventKind, immediate = false) {
  queue.push({ id, kind });
  persist();
  if (immediate) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), 3_000);
}

export async function flush(useBeacon = false): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue.slice(0, 100);
  const body = JSON.stringify({ events: batch });
  if (useBeacon && navigator.sendBeacon) {
    if (navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }))) {
      queue = queue.slice(batch.length);
      persist();
    }
    return;
  }
  try {
    const res = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    if (res.ok || res.status === 400) {
      queue = queue.slice(batch.length);
      persist();
    }
  } catch {
    /* offline: keep queued, retry later */
  }
  if (queue.length && !timer) timer = setTimeout(() => void flush(), 10_000);
}

export function initEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as Ev[];
    if (Array.isArray(saved) && saved.length) {
      queue = saved.concat(queue);
      void flush();
    }
  } catch {
    /* ignore */
  }
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush(true);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("online", () => void flush());
  return () => document.removeEventListener("visibilitychange", onHide);
}
