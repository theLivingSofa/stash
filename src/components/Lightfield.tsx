"use client";

import { useState } from "react";
import { useLightTopic } from "@/lib/client/light";

const colorOf = (t: string | null) => (t ? `var(--t-${t}, var(--accent))` : "var(--accent)");

/**
 * The lightbox behind everything: two soft glow layers that cross-fade when the
 * topic changes, drifting slowly. Only opacity and transform animate, on one
 * fixed layer, so the scrolling cards never repaint it.
 */
export function Lightfield() {
  const topic = useLightTopic();
  const [layers, setLayers] = useState<{ a: string | null; b: string | null; on: "a" | "b"; last: string | null }>({
    a: null,
    b: null,
    on: "a",
    last: null,
  });
  // Adjust during render when the topic changes: load it into the hidden layer, then show that one.
  if (topic !== layers.last) {
    setLayers((l) => (l.on === "a" ? { a: l.a, b: topic, on: "b", last: topic } : { a: topic, b: l.b, on: "a", last: topic }));
  }
  return (
    <div className="lightfield" aria-hidden>
      <div className="light" data-on={layers.on === "a" ? "true" : "false"} style={{ ["--light" as string]: colorOf(layers.a) }} />
      <div className="light" data-on={layers.on === "b" ? "true" : "false"} style={{ ["--light" as string]: colorOf(layers.b) }} />
      <div className="grain" />
    </div>
  );
}
