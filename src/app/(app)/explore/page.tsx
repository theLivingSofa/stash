"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TOPICS } from "@/lib/topics";
import { IconSearch } from "@/components/Icons";

type TopicCount = (typeof TOPICS)[number] & { total: number; unseen: number };

export default function ExplorePage() {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicCount[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/topics", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setTopics(d.topics))
      .catch(() => setTopics(TOPICS.map((t) => ({ ...t, total: 0, unseen: 0 }))));
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/?concept=${encodeURIComponent(q.trim())}`);
        }}
        className="relative"
        role="search"
      >
        <IconSearch className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Follow a concept or a person"
          aria-label="Follow a concept or a person"
          enterKeyHint="go"
          className="w-full rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-11 text-[16px] outline-none placeholder:text-faint focus:border-accent"
        />
      </form>
      <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">
        For example Stoicism, entropy, Ada Lovelace. Stash fetches new ideas on it if you&apos;ve run out.
      </p>

      <h2 className="mt-7 mb-3 px-1 text-[15px] font-medium">Topics</h2>
      <ul className="grid grid-cols-2 gap-2.5">
        {(topics ?? TOPICS.map((t) => ({ ...t, total: -1, unseen: -1 }))).map((t) => (
          <li key={t.slug}>
            <Link
              href={`/?topic=${t.slug}`}
              className="relative flex h-[92px] flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface py-3 pr-3 pl-5"
              style={{ ["--spine" as string]: `var(--t-${t.slug})` }}
            >
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: "var(--spine)" }} aria-hidden />
              <span className="font-serif text-[17px] leading-tight">{t.label}</span>
              <span className="text-[12.5px] text-muted">
                {t.unseen < 0 ? <span className="skeleton inline-block h-3 w-16 align-middle" /> : `${t.unseen} new`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
