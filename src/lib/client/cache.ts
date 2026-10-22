"use client";

import { clear, get, set } from "idb-keyval";
import { currentUid } from "./user";
import type { Card } from "../types";

const key = () => `stash-offline-cards:${currentUid()}`;
const MAX = 50;

/** Keep the most recent ~50 cards (front and back) for offline reading. */
export async function rememberCards(cards: Card[]) {
  try {
    const prev = ((await get<Card[]>(key())) ?? []).filter((c) => !cards.some((n) => n.id === c.id));
    await set(key(), [...prev, ...cards].slice(-MAX));
  } catch {
    /* storage unavailable: offline cache is best-effort */
  }
}

export async function cachedCards(): Promise<Card[]> {
  try {
    return (await get<Card[]>(key())) ?? [];
  } catch {
    return [];
  }
}

export async function patchCachedCard(id: string, patch: Partial<Card>) {
  try {
    const cards = (await get<Card[]>(key())) ?? [];
    await set(key(), cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  } catch {
    /* ignore */
  }
}

/** Wipe everything this device cached (on logout, so the next person starts clean). */
export async function clearDeviceData() {
  try {
    await clear();
  } catch {
    /* ignore */
  }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("stash-pending-events")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
