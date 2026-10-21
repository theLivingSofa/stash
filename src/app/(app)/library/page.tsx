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

  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-[13.5px] ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-text"}`;

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-8">
      <div className="relative" role="search">
        <IconSearch className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your library"
          aria-label="Search your library"
          type="search"
          className="w-full rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-11 text-[16px] outline-none placeholder:text-faint focus:border-accent"
        />
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Show">
        {(["all", "saved", "liked"] as Kind[]).map((k) => (
          <button key={k} type="button" className={chip(kind === k)} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? "Everything" : k === "saved" ? "Saved" : "Liked"}
          </button>
        ))}
      </div>

      <div className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4" role="group" aria-label="Collections">
        <button type="button" className={chip(collection === null)} aria-pressed={collection === null} onClick={() => setCollection(null)}>
          All collections
        </button>
        {collections.map((c) => (
          <button key={c.id} type="button" className={chip(collection === c.id)} aria-pressed={collection === c.id} onClick={() => setCollection(c.id)}>
            {c.name} <span className="opacity-70">{c.count}</span>
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
              className="w-40 rounded-full border border-accent bg-surface px-3 py-1.5 text-[13.5px] outline-none"
            />
            <button type="submit" className="rounded-full bg-accent px-3 py-1.5 text-[13.5px] text-accent-ink">
              Create
            </button>
          </form>
        ) : (
          <button type="button" className="shrink-0 rounded-full border border-dashed border-line px-3.5 py-1.5 text-[13.5px] text-muted" onClick={() => setCreating(true)}>
            New collection
          </button>
        )}
      </div>

      <ul className="mt-5 space-y-2.5">
        {cards === null
          ? [0, 1, 2, 3].map((i) => (
              <li key={i} className="h-[104px] rounded-2xl border border-line bg-surface p-4">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton mt-3 h-4 w-full" />
                <div className="skeleton mt-2 h-4 w-3/4" />
              </li>
            ))
          : cards.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/idea/${c.id}`}
                  className="relative block overflow-hidden rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-6"
                  style={{ ["--spine" as string]: `var(--t-${c.topics[0] ?? "philosophy"})` }}
                >
                  <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: "var(--spine)" }} aria-hidden />
                  <span className="flex items-center justify-between gap-3 text-[12.5px] text-muted">
                    <span>{topicLabel(c.topics[0] ?? "")}</span>
                    <span>{c.saved ? "Saved" : c.reaction === 1 ? "Liked" : ""}</span>
                  </span>
                  {c.title ? <span className="mt-1 block text-[14px] font-medium">{c.title}</span> : null}
                  <span className="mt-1 line-clamp-3 block font-serif text-[15.5px] leading-relaxed">{c.text}</span>
                </Link>
              </li>
            ))}
      </ul>

      {cards && cards.length === 0 ? (
        <div className="mt-10 px-2 text-center">
          <p className="font-serif text-[18px]">{debounced ? "Nothing in your library matches that." : "Your library is empty."}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            {debounced
              ? "Try a different word, or search everything you've saved."
              : "Tap the bookmark or the heart on any card in your feed and it will be kept here, front and back."}
          </p>
        </div>
      ) : null}

      {nextOffset != null ? (
        <button type="button" onClick={() => loadMore(nextOffset)} className="mx-auto mt-5 block rounded-full border border-line px-5 py-2 text-[14px]">
          Show more
        </button>
      ) : null}
    </div>
  );
}
