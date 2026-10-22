import type { Card } from "./types";

/** What read-aloud says for a card: the front, plus the deep dive when asked. */
export function cardSpeech(card: Pick<Card, "title" | "text" | "back">, includeBack: boolean): string {
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
