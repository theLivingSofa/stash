"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/types";
import { topicLabel } from "@/lib/topics";
import { IconSearch } from "@/components/Icons";
import { toast } from "@/components/Toast";

type Kind = "all" | "saved" | "liked";
interface Collection {
  id: string;
  name: string;
  count: number;
}

export default function LibraryPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [collection, setCollection] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const loadCollections = useCallback(() => {
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCollections(d.collections))
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCollections(d.collections))
      .catch(() => {});
  }, []);

  const fetchPage = useCallback(
    async (offset: number): Promise<{ cards: Card[]; nextOffset: number | null }> => {
      const params = new URLSearchParams({ kind, offset: String(offset) });
      if (debounced) params.set("q", debounced);
      if (collection) params.set("collection", collection);
      try {
        const res = await fetch(`/api/stashes?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        return await res.json();
      } catch {
        return { cards: [], nextOffset: null };
      }
    },
    [kind, debounced, collection],
  );

  useEffect(() => {
    const id = ++reqId.current;
    fetchPage(0).then((d) => {
      if (id !== reqId.current) return;
      setCards(d.cards);
      setNextOffset(d.nextOffset);
    });
  }, [fetchPage]);

  const loadMore = (offset: number) => {
    const id = ++reqId.current;
    fetchPage(offset).then((d) => {
      if (id !== reqId.current) return;
      setCards((prev) => [...(prev ?? []), ...d.cards]);
      setNextOffset(d.nextOffset);
    });
  };

  async function createCollection(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const d = await res.json();
    if (!res.ok) return toast(d.error ?? "Couldn't create that collection.");
    setNewName("");
    setCreating(false);
    loadCollections();
    toast(`Created “${d.collection.name}”`);
  }

  const chip = (on: boolean) => `pill label shrink-0 ${on ? "bg-accent text-accent-ink" : "chrome text-text"}`;
  const film = {
    background:
      "radial-gradient(120% 90% at 30% 10%, color-mix(in oklab, var(--light) 55%, white), var(--light) 55%, color-mix(in oklab, var(--light) 72%, black))",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14), 0 0 18px -6px var(--light)",
  };

  return (
    <div className="page-scroll px-4 pt-1">
      <div className="relative" role="search">
        <IconSearch className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your library"
          aria-label="Search your library"
          type="search"
          className="field-input with-icon"
        />
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Show">
        {(["all", "saved", "liked"] as Kind[]).map((k) => (
          <button key={k} type="button" className={chip(kind === k)} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? "Everything" : k === "saved" ? "Saved" : "Liked"}
          </button>
        ))}
      </div>

      <div className="no-scrollbar -mx-4 mt-1 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Collections">
        <button type="button" className={chip(collection === null)} aria-pressed={collection === null} onClick={() => setCollection(null)}>
          All collections
        </button>
        {collections.map((c) => (
          <button key={c.id} type="button" className={chip(collection === c.id)} aria-pressed={collection === c.id} onClick={() => setCollection(c.id)}>
            {c.name} <span className="tabular opacity-70">{c.count}</span>
          </button>
        ))}
        {creating ? (
          <form onSubmit={createCollection} className="flex shrink-0 items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              aria-label="New collection name"
              maxLength={60}
              className="field-input compact w-44"
            />
            <button type="submit" className="pill label bg-accent text-accent-ink">
              Create
            </button>
          </form>
        ) : (
          <button type="button" className="pill label shrink-0 border border-dashed border-line text-muted" onClick={() => setCreating(true)}>
            New collection
          </button>
        )}
      </div>

      <ul className="mt-5 space-y-3">
        {cards === null
          ? [0, 1, 2, 3].map((i) => (
              <li key={i} className="glass flex h-[108px] gap-3 rounded-[22px] p-2" style={{ ["--light" as string]: "var(--accent)" }}>
                <span className="skeleton w-[62px] shrink-0 rounded-[14px]" />
                <span className="flex-1 space-y-2.5 py-2">
                  <span className="skeleton block h-3 w-24" />
                  <span className="skeleton block h-4 w-full" />
                  <span className="skeleton block h-4 w-3/4" />
                </span>
              </li>
            ))
          : cards.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/idea/${c.id}`}
                  className="glass flex gap-3 rounded-[22px] p-2"
                  style={{ ["--light" as string]: `var(--t-${c.topics[0] ?? "philosophy"})` }}
                >
                  <span className="w-[62px] shrink-0 rounded-[14px]" style={film} aria-hidden />
                  <span className="min-w-0 flex-1 py-1.5 pr-2">
                    <span className="band p-0 pb-1.5">
                      <span>{topicLabel(c.topics[0] ?? "")}</span>
                      <span className="ml-auto opacity-70">{c.saved ? "Saved" : c.reaction === 1 ? "Liked" : ""}</span>
                    </span>
                    {c.title ? <span className="label block text-[15.5px] leading-snug">{c.title}</span> : null}
                    <span className="mt-1 line-clamp-2 block font-serif text-[15px] leading-relaxed text-muted">{c.text}</span>
                  </span>
                </Link>
              </li>
            ))}
      </ul>

      {cards && cards.length === 0 ? (
        <div className="glass mx-auto mt-8 max-w-sm rounded-[24px] p-2" style={{ ["--light" as string]: "var(--accent)" }}>
          <div className="window px-6 py-8 text-center">
            <p className="font-serif text-[19px]">{debounced ? "Nothing in your library matches that." : "Your slide sheet is empty."}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {debounced
                ? "Try a different word, or search everything you've saved."
                : "Tap the bookmark or the heart on any card in your feed and it's kept here, front and back."}
            </p>
          </div>
        </div>
      ) : null}

      {nextOffset != null ? (
        <button type="button" onClick={() => loadMore(nextOffset)} className="pill label chrome mx-auto mt-5 flex">
          Show more
        </button>
      ) : null}
    </div>
  );
}
