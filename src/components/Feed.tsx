"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Card, FeedPage } from "@/lib/types";
import { flush, initEvents, track } from "@/lib/client/events";
import { cachedCards, rememberCards } from "@/lib/client/cache";
import { useSettings } from "@/lib/client/settings";
import { stopSpeaking } from "@/lib/client/speak";
import { setLightTopic } from "@/lib/client/light";
import { IdeaCard } from "./IdeaCard";

const SEEN_AFTER_MS = 1_500;
const PREFETCH_WHEN_LEFT = 5;
const PULL_TRIGGER = 72;

type Status = "loading" | "ready" | "offline" | "error";

export function Feed({ topic, concept }: { topic?: string; concept?: string }) {
  const router = useRouter();
  const [settings] = useSettings();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(0);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  // Mirrors seenRef for rendering: seen cards get the grease-pencil tick.
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(() => new Set());
  const genRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- data ----
  const loadPage = useCallback(
    async (reset = false) => {
      if (loadingRef.current && !reset) return;
      loadingRef.current = true;
      const gen = reset ? ++genRef.current : genRef.current;
      if (retryRef.current) clearTimeout(retryRef.current);
      const params = new URLSearchParams();
      if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);
      else {
        if (topic) params.set("topic", topic);
        if (concept) params.set("concept", concept);
      }
      try {
        const res = await fetch(`/api/feed?${params}`, { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`feed ${res.status}`);
        const page = (await res.json()) as FeedPage;
        if (gen !== genRef.current) return;
        cursorRef.current = page.cursor;
        setPending(!!page.pending);
        setCards((prev) => {
          const base = reset ? [] : prev;
          const ids = new Set(base.map((c) => c.id));
          return [...base, ...page.cards.filter((c) => !ids.has(c.id))];
        });
        setStatus("ready");
        void rememberCards(page.cards);
        if (page.pending) retryRef.current = setTimeout(() => void loadPage(), 15_000);
      } catch {
        if (gen !== genRef.current) return;
        if (reset || cards.length === 0) {
          const offline = await cachedCards();
          if (offline.length) {
            setCards(offline);
            setStatus("offline");
          } else setStatus(navigator.onLine ? "error" : "offline");
        } else if (!navigator.onLine) setStatus("offline");
        retryRef.current = setTimeout(() => void loadPage(), navigator.onLine ? 8_000 : 20_000);
      } finally {
        if (gen === genRef.current) loadingRef.current = false;
      }
    },
    // cards.length only matters for the offline fallback decision
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topic, concept, router],
  );

  useEffect(() => {
    const cleanup = initEvents();
    void loadPage(true);
    const online = () => {
      setStatus((s) => (s === "offline" ? "ready" : s));
      void loadPage(true);
    };
    window.addEventListener("online", online);
    return () => {
      cleanup();
      window.removeEventListener("online", online);
      if (retryRef.current) clearTimeout(retryRef.current);
      stopSpeaking();
      void flush(true);
    };
  }, [loadPage]);

  // ---- layout: one card per screen, measured so there's no layout shift ----
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = cards.length + 1; // +1 for the trailing loader card
  // TanStack Virtual manages its own memoisation; React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => height || 700,
    overscan: 2,
  });

  useEffect(() => {
    if (!height) return;
    virtualizer.measure();
    const el = scrollerRef.current;
    if (el) el.scrollTop = active * height;
    // keep the active card in place when the viewport height changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  // ---- active card, seen tracking, prefetch ----
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !height) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(Math.round(el.scrollTop / height)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [height]);

  const activeId = cards[active]?.id;
  const activeTopic = cards[active]?.topics[0] ?? null;
  // The room takes the light of the slide you're reading.
  useEffect(() => {
    setLightTopic(activeTopic);
  }, [activeTopic]);
  useEffect(() => {
    if (flippedId && activeId !== flippedId) setFlippedId(null);
    if (activeId && !seenRef.current.has(activeId)) {
      const t = setTimeout(() => {
        seenRef.current.add(activeId);
        setSeenIds(new Set(seenRef.current));
        track(activeId, "seen");
      }, SEEN_AFTER_MS);
      return () => clearTimeout(t);
    }
  }, [activeId, flippedId]);

  useEffect(() => {
    if (status !== "ready" || pending) return;
    if (cards.length - active <= PREFETCH_WHEN_LEFT) void loadPage();
  }, [active, cards.length, status, pending, loadPage]);

  // ---- card callbacks ----
  const onUpdate = useCallback((id: string, patch: Partial<Card>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const onFlipChange = useCallback((id: string, flipped: boolean) => {
    setFlippedId((cur) => (flipped ? id : cur === id ? null : cur));
    if (flipped) track(id, "flip");
  }, []);

  const onRelated = useCallback(
    (c: string) => {
      setFlippedId(null);
      router.push(`/?concept=${encodeURIComponent(c)}`);
    },
    [router],
  );

  // ---- keyboard (desktop) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flippedId || !height) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const el = scrollerRef.current;
      if (!el) return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown") {
        e.preventDefault();
        el.scrollTo({ top: (active + 1) * height, behavior: "smooth" });
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") {
        e.preventDefault();
        el.scrollTo({ top: Math.max(0, active - 1) * height, behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, height, flippedId]);

  // ---- pull to refresh ----
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setFlippedId(null);
    cursorRef.current = null;
    await flush();
    scrollerRef.current?.scrollTo({ top: 0 });
    setActive(0);
    await loadPage(true);
    setRefreshing(false);
  }, [loadPage]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let startY: number | null = null;
    let dist = 0;
    const onStart = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && !flippedId ? e.touches[0].clientY : null;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      dist = Math.max(0, e.touches[0].clientY - startY);
      if (el.scrollTop > 0) {
        startY = null;
        dist = 0;
      }
      setPull(Math.min(110, dist * 0.55));
    };
    const onEnd = () => {
      if (startY != null && dist * 0.55 >= PULL_TRIGGER) void refresh();
      startY = null;
      setPull(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [flippedId, refresh]);

  const items = virtualizer.getVirtualItems();

  return (
    <div className="absolute inset-0">
      {(pull > 0 || refreshing) && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
          style={{ transform: `translateY(${refreshing ? 18 : pull - 24}px)` }}
          aria-hidden
        >
          <span className="chrome label rounded-full px-3.5 py-1.5 text-[13px] text-muted">
            {refreshing ? "Loading fresh ideas…" : pull >= PULL_TRIGGER ? "Release for fresh ideas" : "Pull for fresh ideas"}
          </span>
        </div>
      )}

      {status === "offline" ? (
        <div className="absolute inset-x-0 top-0 z-10 flex justify-center pt-2" role="status">
          <span className="chrome label rounded-full px-3.5 py-1.5 text-[12.5px] text-muted">
            Offline. Showing your last {cards.length} cards.
          </span>
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className="feed-scroller"
        data-snap={settings.snap ? "true" : "false"}
        data-locked={flippedId ? "true" : "false"}
        data-testid="feed-scroller"
        aria-label="Idea feed"
        role="feed"
        aria-busy={status === "loading"}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {height > 0 &&
            items.map((vi) => {
              const card = cards[vi.index];
              return (
                <div
                  key={card?.id ?? "loader"}
                  className="feed-item"
                  style={{ top: vi.start, height }}
                  data-index={vi.index}
                  aria-posinset={vi.index + 1}
                  aria-setsize={-1}
                  role="article"
                >
                  {card ? (
                    <IdeaCard
                      card={card}
                      seen={seenIds.has(card.id)}
                      forceFront={vi.index !== active}
                      onUpdate={onUpdate}
                      onRelated={onRelated}
                      onFlipChange={onFlipChange}
                    />
                  ) : (
                    <LoaderCard status={status} pending={pending} onRetry={() => void loadPage(cards.length === 0)} />
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function LoaderCard({ status, pending, onRetry }: { status: Status; pending: boolean; onRetry: () => void }) {
  const message =
    status === "offline"
      ? "You're offline. New ideas will load when you reconnect."
      : status === "error"
        ? "Couldn't reach Stash. Retrying automatically."
        : pending
          ? "Finding new ideas for you. This takes about a minute."
          : null;
  return (
    <div className="card3d">
      <div className="face glass" style={{ ["--light" as string]: "var(--accent)" }}>
        <div className="band" aria-hidden>
          <span className="chip-film" />
          <span>{message ? "Stash" : "Loading"}</span>
          <span className="tabular ml-auto opacity-70">No. ----</span>
        </div>
        <div className="window flex flex-col justify-center gap-5 px-7">
          {message ? (
            <>
              <p className="font-serif text-[21px] leading-relaxed">{message}</p>
              {status !== "loading" ? (
                <button type="button" onClick={onRetry} className="pill self-start border border-line">
                  Try now
                </button>
              ) : null}
            </>
          ) : (
            <div className="space-y-3.5" role="status" aria-label="Loading ideas">
              <div className="skeleton h-3.5 w-32" />
              <div className="skeleton h-6 w-full" />
              <div className="skeleton h-6 w-[94%]" />
              <div className="skeleton h-6 w-[88%]" />
              <div className="skeleton h-6 w-[60%]" />
            </div>
          )}
        </div>
        <div className="h-[50px]" aria-hidden />
      </div>
    </div>
  );
}
