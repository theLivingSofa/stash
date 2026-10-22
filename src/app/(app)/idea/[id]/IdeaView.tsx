"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/lib/types";
import { IdeaCard } from "@/components/IdeaCard";
import { IconBack } from "@/components/Icons";
import { toast } from "@/components/Toast";
import { flush, initEvents } from "@/lib/client/events";
import { primedCard } from "@/lib/client/opened";

interface Collection {
  id: string;
  name: string;
}

export function IdeaView({ id }: { id: string }) {
  const router = useRouter();
  // Opened from the Library: show the card it already had at once, then refresh.
  const [card, setCard] = useState<Card | null>(() => primedCard(id));
  const [missing, setMissing] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    const cleanup = initEvents();
    fetch(`/api/ideas/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setCard(d.card))
      .catch(() => setMissing(true));
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCollections(d.collections))
      .catch(() => {});
    return () => {
      cleanup();
      void flush(true);
    };
  }, [id]);

  const onUpdate = useCallback((_: string, patch: Partial<Card>) => setCard((c) => (c ? { ...c, ...patch } : c)), []);
  const onRelated = useCallback((c: string) => router.push(`/?concept=${encodeURIComponent(c)}`), [router]);

  async function addTo(collectionId: string) {
    if (!card || !collectionId) return;
    const res = await fetch(`/api/collections/${collectionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaId: card.id, add: true }),
    });
    const name = collections.find((c) => c.id === collectionId)?.name;
    if (res.ok) {
      setCard({ ...card, saved: true });
      toast(`Added to ${name}`);
    } else toast("Couldn't add it to that collection.");
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 pb-1">
        <button type="button" onClick={() => router.back()} className="pill label chrome text-muted">
          <IconBack /> Library
        </button>
        {collections.length > 0 && card ? (
          <select
            aria-label="Add to collection"
            defaultValue=""
            onChange={(e) => {
              void addTo(e.target.value);
              e.target.value = "";
            }}
            className="chrome label max-w-[55%] rounded-full px-3.5 py-2 text-[13.5px] text-text"
          >
            <option value="" disabled>
              Add to collection
            </option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1 px-3.5" style={{ paddingBottom: "calc(var(--dock-space) + 6px)" }}>
        {card ? (
          <IdeaCard card={card} onUpdate={onUpdate} onRelated={onRelated} />
        ) : missing ? (
          <p className="px-4 pt-10 font-serif text-[19px]">This idea is no longer in your library.</p>
        ) : (
          <div className="face glass" style={{ position: "relative", height: "100%", ["--light" as string]: "var(--accent)" }}>
            <div className="space-y-3 p-8">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-5 w-full" />
              <div className="skeleton h-5 w-[85%]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
