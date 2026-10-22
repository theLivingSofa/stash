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
    <div className="page-scroll px-4 pt-1">
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
          className="field-input with-icon"
        />
      </form>
      <p className="mt-2.5 px-1 text-[13.5px] leading-relaxed text-muted">
        Matches by meaning as well as words, so &ldquo;happiness&rdquo; also finds well-being. Names work too, like Ada
        Lovelace. If you&apos;ve run out, Stash fetches new ideas on it.
      </p>

      <h1 className="display mt-8 mb-3 px-1 text-[20px]" style={{ fontStretch: "76%" }}>
        Topics
      </h1>
      <ul className="grid grid-cols-2 gap-3">
        {(topics ?? TOPICS.map((t) => ({ ...t, total: -1, unseen: -1 }))).map((t) => (
          <li key={t.slug}>
            <Link
              href={`/?topic=${t.slug}`}
              className="glass block rounded-[22px] p-2"
              style={{ ["--light" as string]: `var(--t-${t.slug})` }}
            >
              {/* The slide's film: the topic's dye, lit from behind. */}
              <span
                className="flex h-[78px] items-end rounded-[15px] px-3 pb-2.5"
                style={{
                  background:
                    "radial-gradient(120% 90% at 30% 10%, color-mix(in oklab, var(--light) 55%, white), var(--light) 55%, color-mix(in oklab, var(--light) 72%, black))",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14), 0 0 22px -6px var(--light)",
                }}
              >
                <span className="display text-[19px] leading-none text-[#15110c]" style={{ fontStretch: "72%" }}>
                  {t.label}
                </span>
              </span>
              <span className="band px-1.5 pt-2.5 pb-1">
                <span className="tabular">{t.unseen < 0 ? "…" : `${t.unseen} new`}</span>
                <span className="tabular ml-auto opacity-60">{t.total < 0 ? "" : `${t.total} total`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
