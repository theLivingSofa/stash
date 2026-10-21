"use client";

import { get, set } from "idb-keyval";
import type { Card } from "../types";

const KEY = "stash-offline-cards";
const MAX = 50;

/** Keep the most recent ~50 cards (front and back) for offline reading. */
export async function rememberCards(cards: Card[]) {
  try {
    const prev = ((await get<Card[]>(KEY)) ?? []).filter((c) => !cards.some((n) => n.id === c.id));
    await set(KEY, [...prev, ...cards].slice(-MAX));
  } catch {
    /* storage unavailable: offline cache is best-effort */
  }
}

export async function cachedCards(): Promise<Card[]> {
  try {
    return (await get<Card[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function patchCachedCard(id: string, patch: Partial<Card>) {
  try {
    const cards = (await get<Card[]>(KEY)) ?? [];
    await set(KEY, cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  } catch {
    /* ignore */
  }
}
