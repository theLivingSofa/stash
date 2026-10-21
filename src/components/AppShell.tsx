"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { topicLabel } from "@/lib/topics";
import { IconClose, IconExplore, IconFeed, IconFlame, IconLibrary, IconSettings } from "./Icons";
import { Toaster } from "./Toast";

const NAV = [
  { href: "/", label: "Feed", Icon: IconFeed },
  { href: "/explore", label: "Explore", Icon: IconExplore },
  { href: "/library", label: "Library", Icon: IconLibrary },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app-frame">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5" style={{ height: "var(--top-h)" }}>
        <Link href="/" className="font-serif text-[21px] font-semibold tracking-tight" aria-label="Stash, go to feed">
          Stash
        </Link>
        <Suspense fallback={null}>
          <FilterChip />
        </Suspense>
        <Streak />
      </header>
      <main className="app-main">{children}</main>
      <nav className="bottom-nav grid shrink-0 grid-cols-4" aria-label="Main">
        {NAV.map(({ href, label, Icon }) => {
          const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11.5px] ${on ? "text-accent" : "text-muted"}`}
            >
              <Icon size={22} />
              {label}
            </Link>
          );
        })}
      </nav>
      <Toaster />
    </div>
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
        className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-2 pl-3 text-[13px]"
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
      className="inline-flex min-w-[3.25rem] items-center justify-end gap-1 text-[13.5px] text-muted"
      title="Days in a row you've read at least one idea"
      aria-label={streak != null ? `${streak} day reading streak` : undefined}
    >
      {streak != null ? (
        <>
          <IconFlame className={streak > 0 ? "text-accent" : undefined} />
          {streak}
        </>
      ) : null}
    </span>
  );
}
