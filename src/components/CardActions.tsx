"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Card } from "@/lib/types";
import { track } from "@/lib/client/events";
import { patchCachedCard } from "@/lib/client/cache";
import { canSpeak, cardSpeech, speak, stopSpeaking } from "@/lib/client/speak";
import { useSettings } from "@/lib/client/settings";
import { IconBookmark, IconLess, IconMore, IconShare, IconSpeak } from "./Icons";
import { toast } from "./Toast";

const noopSubscribe = () => () => {};

let speakingId: string | null = null;
const speakListeners = new Set<() => void>();
const setSpeaking = (id: string | null) => {
  speakingId = id;
  speakListeners.forEach((l) => l());
};

function useSpeaking(id: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const l = () => setOn(speakingId === id);
    speakListeners.add(l);
    return () => {
      speakListeners.delete(l);
    };
  }, [id]);
  return on;
}

export function CardActions({
  card,
  onUpdate,
  includeBack,
}: {
  card: Card;
  onUpdate: (id: string, patch: Partial<Card>) => void;
  includeBack: boolean;
}) {
  const [settings] = useSettings();
  const speaking = useSpeaking(card.id);
  const [pop, setPop] = useState(false);
  const speechOk = useSyncExternalStore(noopSubscribe, canSpeak, () => false);

  const save = () => {
    const saved = !card.saved;
    onUpdate(card.id, { saved });
    void patchCachedCard(card.id, { saved });
    track(card.id, saved ? "save" : "unsave", true);
    if (saved) {
      navigator.vibrate?.(12);
      setPop(true);
      setTimeout(() => setPop(false), 300);
      toast("Saved to your Library");
    } else toast("Removed from your Library");
  };

  const react = (value: 1 | -1) => {
    const next = card.reaction === value ? 0 : value;
    onUpdate(card.id, { reaction: next });
    void patchCachedCard(card.id, { reaction: next });
    track(card.id, next === 0 ? "unreact" : next === 1 ? "like" : "dislike", true);
    if (next !== 0) navigator.vibrate?.(8);
    if (next === 1) toast("More like this. Kept in your Library under Liked");
    if (next === -1) toast("Less like this");
  };

  const share = async () => {
    const text = `${card.title ? `${card.title}\n\n` : ""}${card.text}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: card.title ?? "An idea from Stash", text, url: card.source.url || undefined });
      } else {
        await navigator.clipboard.writeText(`${text}\n\n${card.source.url}`);
        toast("Copied to clipboard");
      }
      track(card.id, "share");
    } catch {
      /* share sheet dismissed */
    }
  };

  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(null);
      return;
    }
    setSpeaking(card.id);
    speak(cardSpeech(card, includeBack), {
      voice: settings.voice,
      rate: settings.rate,
      onEnd: () => speakingId === card.id && setSpeaking(null),
      onFail: () => {
        if (speakingId === card.id) setSpeaking(null);
        toast("Read-aloud didn't start. On iPhone, turn off Silent mode and check the volume, then try again.");
      },
    });
  };

  const btn = "inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:text-text active:bg-surface-2";

  return (
    <div className="flex items-center justify-between pt-1">
      <div className="-ml-2.5 flex items-center gap-1">
        <button type="button" className={btn} onClick={() => react(1)} aria-pressed={card.reaction === 1} aria-label="More like this">
          <IconMore filled={card.reaction === 1} className={card.reaction === 1 ? "text-accent" : undefined} />
        </button>
        <button type="button" className={btn} onClick={() => react(-1)} aria-pressed={card.reaction === -1} aria-label="Less like this">
          <IconLess filled={card.reaction === -1} className={card.reaction === -1 ? "text-danger" : undefined} />
        </button>
        {speechOk ? (
          <button type="button" className={btn} onClick={toggleSpeak} aria-pressed={speaking} aria-label={speaking ? "Stop reading aloud" : "Read aloud"}>
            <IconSpeak active={speaking} className={speaking ? "text-accent" : undefined} />
          </button>
        ) : null}
        <button type="button" className={btn} onClick={share} aria-label="Share">
          <IconShare />
        </button>
      </div>
      <button
        type="button"
        className={`${btn} -mr-2.5 ${card.saved ? "text-accent" : ""}`}
        onClick={save}
        aria-pressed={card.saved}
        aria-label={card.saved ? "Remove from Library" : "Save to Library"}
      >
        <IconBookmark filled={card.saved} className={pop ? "save-pop" : undefined} />
      </button>
    </div>
  );
}
