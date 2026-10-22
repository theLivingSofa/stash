"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { setLightTopic } from "@/lib/client/light";
import { topicLabel } from "@/lib/topics";
import { IconClose, IconExplore, IconFeed, IconFlame, IconLibrary, IconSettings } from "./Icons";
import { Lightfield } from "./Lightfield";
import { Toaster } from "./Toast";

const NAV = [
  { href: "/", label: "Feed", Icon: IconFeed },
  { href: "/explore", label: "Explore", Icon: IconExplore },
  { href: "/library", label: "Library", Icon: IconLibrary },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Off the feed, the room returns to the house light.
  useEffect(() => {
    if (pathname !== "/") setLightTopic(null);
  }, [pathname]);
  return (
    <>
      <Lightfield />
      <div className="app-frame">
        <header className="flex shrink-0 items-center justify-between gap-3 px-5" style={{ height: "var(--top-h)" }}>
          <Link href="/" className="display text-[27px] leading-none tracking-[-0.01em]" style={{ fontStretch: "72%" }} aria-label="Stash, go to feed">
            Stash
          </Link>
          <Suspense fallback={null}>
            <FilterChip />
          </Suspense>
          <Streak />
        </header>
        <main className="app-main">{children}</main>
      </div>
      <nav className="dock chrome grid grid-cols-4" aria-label="Main">
        {NAV.map(({ href, label, Icon }) => {
          const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`label flex flex-col items-center justify-center gap-0.5 rounded-full text-[11.5px] transition-colors ${
                on ? "bg-surface-2 text-text" : "text-muted"
              }`}
            >
              <Icon size={21} style={on ? { color: "var(--accent)" } : undefined} />
              {label}
            </Link>
          );
        })}
      </nav>
      <Toaster />
    </>
  );
}

function FilterChip() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const topic = sp.get("topic");
  const concept = sp.get("concept");
  if (pathname !== "/" || (!topic && !concept)) return <span className="flex-1" />;
  const label = concept ?? topicLabel(topic!);
  return (
    <div className="flex min-w-0 flex-1 justify-center">
      <Link
        href="/"
        className="chrome pill label min-w-0 py-1.5 pr-2.5 pl-3.5 text-[13px]"
        aria-label={`Showing ${label}. Clear filter`}
      >
        <span className="truncate">{label}</span>
        <IconClose size={14} className="shrink-0 text-muted" />
      </Link>
    </div>
  );
}

function Streak() {
  const [streak, setStreak] = useState<number | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    let alive = true;
    fetch(`/api/stats?tz=${new Date().getTimezoneOffset()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setStreak(d.streak))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);
  return (
    <span
      className={`label tabular inline-flex min-w-[3.25rem] items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[13.5px] ${streak != null ? "chrome" : ""}`}
      title="Days in a row you've read at least one idea"
      aria-label={streak != null ? `${streak} day reading streak` : undefined}
    >
      {streak != null ? (
        <>
          <IconFlame style={{ color: streak > 0 ? "var(--accent)" : undefined }} />
          {streak}
        </>
      ) : null}
    </span>
  );
}
