"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Card, IdeaBack } from "@/lib/types";
import { topicLabel } from "@/lib/topics";
import { CardActions } from "./CardActions";
import { IconBack, IconDetails, IconExternal } from "./Icons";

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
  /** Parent can force the card back to its front (e.g. when it leaves the screen). */
  forceFront?: boolean;
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

export const IdeaCard = memo(function IdeaCard({ card, forceFront, onUpdate, onRelated, onFlipChange }: Props) {
  const [side, setSide] = useState<Side>("front");
  const [rest, setRest] = useState<Side | null>("front");
  const [instant, setInstant] = useState(false);
  const [backMounted, setBackMounted] = useState(false);
  const detailsRef = useRef<HTMLButtonElement>(null);
  const backHeaderRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spine = `var(--t-${card.topics[0] ?? "philosophy"}, var(--accent))`;

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
          className="face face-front"
          style={{ ["--spine" as string]: spine }}
          aria-hidden={side === "back"}
          inert={side === "back"}
          aria-label={card.title ?? "Idea"}
        >
          <Spine topic={card.topics[0]} />
          <Front card={card} detailsRef={detailsRef} onOpen={open} onUpdate={onUpdate} flipped={side === "back"} />
        </article>

        <article
          className="face face-back"
          style={{ ["--spine" as string]: spine }}
          aria-hidden={side === "front"}
          inert={side === "front"}
          aria-label={`Details: ${card.title ?? "idea"}`}
        >
          <Spine topic={card.topics[0]} />
          {backMounted ? (
            <Back card={card} headerRef={backHeaderRef} onClose={close} onUpdate={onUpdate} onRelated={onRelated} />
          ) : null}
        </article>
      </div>
    </div>
  );
});

function Spine({ topic }: { topic?: string }) {
  return (
    <div className="spine" aria-hidden>
      <span className="spine-label">{topicLabel(topic ?? "ideas")}</span>
    </div>
  );
}

function Front({
  card,
  detailsRef,
  onOpen,
  onUpdate,
  flipped,
}: {
  card: Card;
  detailsRef: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
  onUpdate: CardHandlers["onUpdate"];
  flipped: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shrink, setShrink] = useState(1);

  // Keep the whole idea on one screen: step the type down if it would overflow.
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
  }, [card.text, card.title, card.why]);

  return (
    <div className="flex h-full flex-col pl-[30px]">
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-5 pt-5 pb-2" style={{ ["--fit" as string]: shrink }}>
        {card.beyond ? (
          <p className="mb-4 text-[13px] leading-snug text-accent">
            You&apos;ve seen everything new on &ldquo;{card.beyond}&rdquo;. Here&apos;s more from across your feed.
          </p>
        ) : null}
        {card.title ? <h2 className="mb-3 text-[13.5px] font-medium leading-snug text-muted">{card.title}</h2> : null}
        <p
          className="idea-text"
          data-len={lengthBucket(card.text)}
        >
          {card.text}
        </p>
        {card.why ? (
          <p className="mt-4 leading-relaxed text-muted" style={{ fontSize: `calc(14px * max(var(--fit, 1), 0.85))` }}>
            {card.why}
          </p>
        ) : null}
      </div>
      <footer className="px-5 pb-3">
        <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
          <span className="min-w-0 truncate text-faint" title={card.source.title}>
            {card.source.domain || "source"}
          </span>
          <button
            ref={detailsRef}
            type="button"
            onClick={onOpen}
            aria-expanded={flipped}
            className="-mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-[13.5px] text-accent underline-offset-4 hover:underline"
          >
            <IconDetails />
            Details
          </button>
        </div>
        <CardActions card={card} onUpdate={onUpdate} includeBack={false} />
      </footer>
    </div>
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
    <div className="flex h-full flex-col pl-[30px]">
      <button
        ref={headerRef}
        type="button"
        onClick={onClose}
        aria-expanded
        aria-label={`Back to idea${card.title ? `: ${card.title}` : ""}`}
        className="flex w-full items-start gap-2 border-b border-line px-5 pt-4 pb-3 text-left"
      >
        <IconBack className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0">
          <span className="block text-[13px] text-accent">Back to idea</span>
          <span className="mt-0.5 block font-serif text-[17px] leading-snug">{card.title ?? card.concept ?? "Details"}</span>
        </span>
      </button>

      <div className="back-scroll min-h-0 flex-1 px-5 py-4" data-testid="back-scroll">
        {state === "loading" && !back ? <BackSkeleton /> : null}
        {state === "error" && !back ? (
          <div className="py-6 text-[15px]">
            <p className="text-muted">{error}</p>
            <button type="button" onClick={load} className="mt-3 rounded-full border border-line px-4 py-2 text-[14px]">
              Try again
            </button>
          </div>
        ) : null}
        {back ? (
          <div className="prose-back space-y-5">
            <Section title="Concept" body={back.concept} />
            <Section title="Where it comes from" body={back.origin} />
            <Section title="The thinking behind it" body={back.reasoning} />
            <Section title="Example" body={back.example} />
            {back.related.length ? (
              <section>
                <h3 className="mb-2 font-sans text-[13px] font-medium text-muted">Related</h3>
                <div className="flex flex-wrap gap-2">
                  {back.related.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => onRelated(r)}
                      className="rounded-full border border-line bg-surface-2 px-3 py-1.5 font-sans text-[13.5px] hover:border-accent"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {back.confidence === "low" ? (
              <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-sans text-[13.5px] leading-relaxed text-muted">
                Some details here are contested or uncertain. Treat this as a starting point, and check the original or
                the Wikipedia link before relying on it.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1 pb-2 font-sans text-[14px]">
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

      <div className="border-t border-line px-5 pb-3">
        <CardActions card={card} onUpdate={onUpdate} includeBack />
      </div>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3 className="mb-1.5 font-sans text-[13px] font-medium text-muted">{title}</h3>
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
