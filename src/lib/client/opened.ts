"use client";

import type { Card } from "../types";

// Cards the Library list already has, so tapping one opens it instantly
// (the full view still refreshes it from the server).
const primed = new Map<string, Card>();

export const primeCard = (c: Card) => primed.set(c.id, c);
export const primedCard = (id: string) => primed.get(id) ?? null;
