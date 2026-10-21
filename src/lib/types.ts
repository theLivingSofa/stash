// Types shared by server and client.

export type Confidence = "high" | "medium" | "low";

export interface IdeaBack {
  concept: string;
  origin: string;
  reasoning: string;
  example: string;
  related: string[];
  confidence: Confidence;
}

/** "new" in the feed; "seen"/"remember" when shown from the Library. */
export type CardKind = "new" | "seen" | "remember";

export interface Card {
  id: string;
  title: string | null;
  text: string;
  topics: string[];
  why: string | null;
  concept: string | null;
  back: IdeaBack | null;
  learnMoreUrl: string | null;
  source: { title: string; author: string | null; url: string; domain: string };
  createdAt: string;
  kind: CardKind;
  saved: boolean;
  reaction: -1 | 0 | 1;
  /** Set on the first card shown after a filter ran dry and the feed widened. */
  beyond?: string;
}

export interface FeedPage {
  cards: Card[];
  cursor: string;
  /** Present when the requested filter has been exhausted and the feed widened. */
  widenedFrom?: string;
  /** No unseen ideas right now; new ones are being generated. Retry shortly. */
  pending?: boolean;
}

export type EventKind = "seen" | "save" | "unsave" | "like" | "dislike" | "unreact" | "flip" | "share";
