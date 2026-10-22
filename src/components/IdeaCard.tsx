"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Card, IdeaBack } from "@/lib/types";
import { topicLabel } from "@/lib/topics";
import { CardActions } from "./CardActions";
import { toast } from "./Toast";
import { IconBack, IconExternal, IconTurn } from "./Icons";

const FLIP_MS = 350;
const FADE_MS = 170;

type Side = "front" | "back";

export interface CardHandlers {
  onUpdate: (id: string, patch: Partial<Card>) => void;
  onRelated: (concept: string) => void;
  onFlipChange?: (id: string, flipped: boolean) => void;
}

interface Props extends CardHandlers {
  card: Card;
  /** Seen in this session (on screen 1.5s): shows the grease-pencil tick. */
  seen?: boolean;
  /** Parent can force the card back to its front (e.g. when it leaves the screen). */
  forceFront?: boolean;
  /** The topic the feed is filtered to: label and light the card with it when it has it. */
  focus?: string;
}

/** The topic a card wears: the feed's topic if the card has it, else its main topic. */
export function cardTopic(card: Card, focus?: string | null): string {
  return focus && card.topics.includes(focus) ? focus : (card.topics[0] ?? "philosophy");
}

/** Next animation frame, with a timer fallback for throttled (background) pages. */
function nextFrame(cb: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cb();
  };
  requestAnimationFrame(run);
  setTimeout(run, 50);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function lengthBucket(text: string): "short" | "normal" | "long" {
  const n = text.split(/\s+/).length;
  return n < 38 ? "short" : n > 78 ? "long" : "normal";
}

export const IdeaCard = memo(function IdeaCard({ card, seen = false, forceFront, focus, onUpdate, onRelated, onFlipChange }: Props) {
  const [side, setSide] = useState<Side>("front");
  const [rest, setRest] = useState<Side | null>("front");
  const [instant, setInstant] = useState(false);
  const [backMounted, setBackMounted] = useState(false);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const backHeaderRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topic = cardTopic(card, focus);
  const light = `var(--t-${topic}, var(--accent))`;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flipTo = useCallback(
    (target: Side, focus = true) => {
      if (timer.current) clearTimeout(timer.current);
      const reduced = prefersReducedMotion();
      if (target === "back") setBackMounted(true);
      onFlipChange?.(card.id, target === "back");

      const finish = () => {
        setRest(target);
        if (!focus) return;
        setTimeout(() => (target === "back" ? backHeaderRef.current : detailsRef.current)?.focus({ preventScroll: true }), 0);
      };

      if (target === "front" && rest === "back") {
        // Re-enter 3D at 180deg without animating, then animate back to 0.
        setInstant(true);
        setRest(null);
        nextFrame(() =>
          nextFrame(() => {
            setInstant(false);
            setSide("front");
            timer.current = setTimeout(finish, reduced ? FADE_MS : FLIP_MS);
          }),
        );
        return;
      }
      setRest(null);
      nextFrame(() => {
        setSide(target);
        timer.current = setTimeout(finish, reduced ? FADE_MS : FLIP_MS);
      });
    },
    [card.id, onFlipChange, rest],
  );

  // Leaving the card (scrolled away, navigated) resets it to the front.
  if (forceFront && side === "back") {
    setSide("front");
    setRest("front");
    setInstant(false);
  }
  useEffect(() => {
    if (forceFront && timer.current) clearTimeout(timer.current);
  }, [forceFront]);

  const open = () => flipTo("back");
  const close = () => flipTo("front");
  const animating = rest === null;

  return (
    <div className="card3d">
      <div
        className="flipper"
        data-side={side}
        data-rest={rest ?? undefined}
        data-animating={animating ? "true" : undefined}
        style={instant ? { transition: "none" } : undefined}
      >
        <article
          className="face face-front glass"
          style={{ ["--light" as string]: light }}
          aria-hidden={side === "back"}
          inert={side === "back"}
          aria-label={card.title ?? "Idea"}
        >
          <span className="tape" data-on={card.saved ? "true" : "false"} aria-hidden />
          <Band card={card} topic={topic} />
          <Front card={card} seen={seen} detailsRef={detailsRef} onOpen={open} onUpdate={onUpdate} flipped={side === "back"} />
        </article>

        <article
          className="face face-back glass"
          style={{ ["--light" as string]: light }}
          aria-hidden={side === "front"}
          inert={side === "front"}
          aria-label={`Details: ${card.title ?? "idea"}`}
        >
          <Band card={card} topic={topic} back />
          {backMounted ? (
            <Back card={card} headerRef={backHeaderRef} onClose={close} onUpdate={onUpdate} onRelated={onRelated} />
          ) : null}
        </article>
      </div>
    </div>
  );
});

/** Four-digit slide number derived from the idea id: a literal label, like a mount stamp. */
export function slideNumber(id: string): string {
  const n = parseInt(id.replace(/-/g, "").slice(0, 6), 16);
  return String(Number.isFinite(n) ? n % 10000 : 0).padStart(4, "0");
}

/** The mount's printed band: topic, slide number, source. */
function Band({ card, topic, back = false }: { card: Card; topic: string; back?: boolean }) {
  return (
    <div className="band" aria-hidden>
      <span className="chip-film" />
      <span>{topicLabel(topic)}</span>
      <span className="tabular opacity-70">No. {slideNumber(card.id)}</span>
      <span className="ml-auto min-w-0 truncate opacity-80" style={{ textTransform: "none", letterSpacing: "0.01em" }}>
        {back ? "Notes" : card.source.domain || "source"}
      </span>
    </div>
  );
}

function Front({
  card,
  seen,
  detailsRef,
  onOpen,
  onUpdate,
  flipped,
}: {
  card: Card;
  seen: boolean;
  detailsRef: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onUpdate: CardHandlers["onUpdate"];
  flipped: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shrink, setShrink] = useState(1);
  // Spaced recall: the question first, the idea on "Show answer", then a verdict.
  const [recall, setRecall] = useState<"ask" | "judge" | "done" | null>(card.recall ? "ask" : null);
  const asking = recall === "ask";

  const answer = async (ok: boolean) => {
    setRecall("done");
    navigator.vibrate?.(8);
    try {
      const res = await fetch("/api/recall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: card.id, ok }),
      });
      const { days } = (await res.json()) as { days: number | null };
      if (days) toast(ok ? `Nice. Back in ${days} ${days === 1 ? "day" : "days"}.` : "No problem. It'll come back tomorrow.");
    } catch {
      /* offline: the card simply stays due */
    }
  };

  // Keep the whole idea in the window: step the type down if it would overflow.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let s = 1;
    const fit = () => {
      s = 1;
      body.style.setProperty("--fit", "1");
      for (let i = 0; i < 6 && body.scrollHeight > body.clientHeight + 1; i++) {
        s -= 0.07;
        body.style.setProperty("--fit", String(s));
      }
      setShrink(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(body);
    return () => ro.disconnect();
  }, [card.text, card.title, card.why, asking]);

  const question =
    card.recall?.question ?? (card.title ? `What was the idea behind “${card.title}”?` : "Do you remember this idea?");

  return (
    <>
      <div className="window">
        <svg className="tick absolute top-4 right-4 h-[16px] w-[21px]" viewBox="0 0 28 22" data-on={seen ? "true" : "false"} aria-hidden>
          <path d="M3 12.5 L10.5 19 L25 3.5" fill="none" stroke="var(--grease)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div
          ref={bodyRef}
          className="flex h-full flex-col justify-center overflow-hidden px-6 py-8"
          style={{ ["--fit" as string]: shrink }}
        >
          {asking ? (
            <>
              <p className="label mb-4 text-[13.5px] text-accent">Remember this one?</p>
              <p className="idea-text" data-len="short">
                {question}
              </p>
              <p className="mt-5 text-[14.5px] leading-relaxed text-muted">Think of your answer, then check it.</p>
            </>
          ) : null}
          {asking ? null : card.beyond ? (
            <p className="label mb-4 text-[13.5px] leading-snug text-accent">
              That&apos;s everything new on &ldquo;{card.beyond}&rdquo;. More from across your feed.
            </p>
          ) : null}
          {asking ? null : card.title ? <h2 className="idea-title mb-3">{card.title}</h2> : null}
          {asking ? null : (
            <p className="idea-text" data-len={lengthBucket(card.text)}>
              {card.text}
            </p>
          )}
          {!asking && card.why ? (
            <p className="mt-5 leading-relaxed text-muted" style={{ fontSize: `calc(14.5px * max(var(--fit, 1), 0.86))` }}>
              {card.why}
            </p>
          ) : null}
        </div>
      </div>
      {recall === "ask" ? (
        <footer className="flex items-center justify-between gap-2 pt-2 pl-2">
          <span className="label text-[13px] text-muted">Review</span>
          <button type="button" onClick={() => setRecall("judge")} className="pill turn shrink-0">
            Show answer
          </button>
        </footer>
      ) : recall === "judge" ? (
        <footer className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={() => answer(false)} className="pill chrome shrink-0 text-[14px]">
            Not yet
          </button>
          <button type="button" onClick={() => answer(true)} className="pill turn shrink-0">
            Got it
          </button>
        </footer>
      ) : (
      <footer className="flex items-center justify-between gap-2 pt-2 pl-0.5">
        <CardActions card={card} onUpdate={onUpdate} includeBack={false} />
        <button
          ref={detailsRef}
          type="button"
          onClick={onOpen}
          aria-expanded={flipped}
          className="pill turn shrink-0"
        >
          <IconTurn />
          Turn over
        </button>
      </footer>
      )}
    </>
  );
}

function Back({
  card,
  headerRef,
  onClose,
  onUpdate,
  onRelated,
}: {
  card: Card;
  headerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onUpdate: CardHandlers["onUpdate"];
  onRelated: (c: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">(card.back ? "idle" : "loading");
  const [error, setError] = useState<string | null>(null);

  // Fallback for ideas stored without a BACK: generate it on demand (cached server-side).
  const fetchBack = useCallback(
    () =>
      fetch(`/api/ideas/${card.id}/deep`, { method: "POST" })
        .then(async (res) => {
          const data = (await res.json()) as { back?: IdeaBack; learnMoreUrl?: string | null; error?: string };
          if (!res.ok || !data.back) throw new Error(data.error ?? "Couldn't load the deep dive.");
          onUpdate(card.id, { back: data.back, learnMoreUrl: data.learnMoreUrl ?? card.learnMoreUrl });
          setState("idle");
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "Couldn't load the deep dive.");
          setState("error");
        }),
    [card.id, card.learnMoreUrl, onUpdate],
  );

  const load = () => {
    setState("loading");
    setError(null);
    void fetchBack();
  };

  useEffect(() => {
    if (!card.back) void fetchBack();
    // run once when the back is first shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = card.back;
  return (
    <>
      <div className="window flex flex-col">
        <button
          ref={headerRef}
          type="button"
          onClick={onClose}
          aria-expanded
          aria-label={`Back to idea${card.title ? `: ${card.title}` : ""}`}
          className="flex w-full items-start gap-3 border-b border-line px-5 pt-4 pb-3.5 text-left"
        >
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent">
            <IconBack />
          </span>
          <span className="min-w-0">
            <span className="label block text-[13px] text-accent">Back to idea</span>
            <span className="mt-0.5 block font-serif text-[18px] leading-snug">{card.title ?? card.concept ?? "Details"}</span>
          </span>
        </button>

        <div className="back-scroll min-h-0 flex-1 px-5 py-5" data-testid="back-scroll">
          {state === "loading" && !back ? <BackSkeleton /> : null}
          {state === "error" && !back ? (
            <div className="py-6 text-[15px]">
              <p className="text-muted">{error}</p>
              <button type="button" onClick={load} className="pill mt-3 border border-line">
                Try again
              </button>
            </div>
          ) : null}
          {back ? (
            <div className="prose-back space-y-6">
              <Section title="Concept" body={back.concept} />
              <Section title="Where it comes from" body={back.origin} />
              <Section title="The thinking behind it" body={back.reasoning} />
              <Section title="Example" body={back.example} />
              {back.related.length ? (
                <section>
                  <h3 className="back-h">Related</h3>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {back.related.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onRelated(r)}
                        className="pill border border-line bg-surface-2 font-sans text-text hover:border-accent"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {back.confidence === "low" ? (
                <p className="rounded-2xl bg-surface-2 px-4 py-3 font-sans text-[13.5px] leading-relaxed text-muted">
                  Some details here are contested or uncertain. Treat this as a starting point, and check the original or
                  the Wikipedia link before relying on it.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 font-sans text-[14.5px] font-semibold">
                {card.source.url ? (
                  <a href={card.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline">
                    Read original <IconExternal />
                  </a>
                ) : null}
                {card.learnMoreUrl ? (
                  <a href={card.learnMoreUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent underline-offset-4 hover:underline">
                    Learn more on Wikipedia <IconExternal />
                  </a>
                ) : null}
              </div>
              <p className="pb-1 font-sans text-[12.5px] leading-relaxed text-faint">
                From {card.source.title}
                {card.source.author ? `, by ${card.source.author}` : ""} ({card.source.domain}). Summarised in Stash&apos;s own words.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="pt-2 pl-0.5">
        <CardActions card={card} onUpdate={onUpdate} includeBack />
      </footer>
    </>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3 className="back-h">{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function BackSkeleton() {
  return (
    <div className="space-y-6 py-1" aria-label="Writing the deep dive" role="status">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-[92%]" />
          <div className="skeleton h-3.5 w-[70%]" />
        </div>
      ))}
    </div>
  );
}
