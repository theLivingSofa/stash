"use client";

/** The signed-in user's id (from a non-secret cookie), used to keep device caches per person. */
export function currentUid(): string {
  if (typeof document === "undefined") return "anon";
  return document.cookie.match(/(?:^|;\s*)stash_uid=([^;]+)/)?.[1] ?? "anon";
}
