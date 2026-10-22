"use client";

import { useSyncExternalStore } from "react";

/** The topic whose film-dye colour lights the room (null = the house accent). */
let topic: string | null = null;
const listeners = new Set<() => void>();

export function setLightTopic(next: string | null) {
  if (next === topic) return;
  topic = next;
  listeners.forEach((l) => l());
}

export function useLightTopic(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => topic,
    () => null,
  );
}
