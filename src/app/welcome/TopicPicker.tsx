"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Lightfield } from "@/components/Lightfield";
import { TOPICS } from "@/lib/topics";

const MIN = 3;

/**
 * First sign-in (and Settings > Your topics): pick what to read. Picked slides
 * light up on the box; the rest stay unlit film.
 */
export function TopicPicker({ edit }: { edit: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { interests?: string[] } | null) => me?.interests?.length && setPicked(new Set(me.interests)))
      .catch(() => {});
  }, []);

  const toggle = (slug: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(slug)) n.delete(slug);
      else n.add(slug);
      return n;
    });

  async function save(topics: string[]) {
    setSaving(true);
    await fetch("/api/me/interests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topics }),
    }).catch(() => {});
    router.replace(edit ? "/settings" : "/");
  }

  const ready = picked.size >= MIN;
  return (
    <>
      <Lightfield />
      <main className="relative z-[1] mx-auto flex max-w-[560px] flex-col px-4" style={{ minHeight: "100dvh", paddingTop: "calc(env(safe-area-inset-top) + 28px)" }}>
        <h1 className="display px-1 text-[34px] leading-[1.02] tracking-[-0.01em]">
          What are you
          <br />
          curious about?
        </h1>
        <p className="mt-3 px-1 text-[15px] leading-relaxed text-muted">
          Pick at least {MIN}. Stash starts with these and keeps learning from what you read{edit ? "" : ". You can change them anytime in Settings"}.
        </p>

        <ul className="mt-6 grid grid-cols-2 gap-2.5 pb-40">
          {TOPICS.map((t) => {
            const on = picked.has(t.slug);
            return (
              <li key={t.slug}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(t.slug)}
                  className="glass relative block w-full rounded-[20px] p-1.5 text-left transition-transform duration-150 active:scale-[0.97]"
                  style={{ ["--light" as string]: `var(--t-${t.slug})` }}
                >
                  <span
                    className="flex h-[64px] items-end rounded-[14px] px-3 pb-2 transition-[filter,opacity] duration-300"
                    style={{
                      background:
                        "radial-gradient(120% 90% at 30% 10%, color-mix(in oklab, var(--light) 55%, white), var(--light) 55%, color-mix(in oklab, var(--light) 72%, black))",
                      boxShadow: on ? "inset 0 0 0 1px rgba(0,0,0,.14), 0 0 22px -4px var(--light)" : "inset 0 0 0 1px rgba(0,0,0,.2)",
                      // Unpicked: unlit film, grey but still readable.
                      filter: on ? "none" : "grayscale(0.9) brightness(1.08) contrast(0.85)",
                      opacity: on ? 1 : 0.8,
                    }}
                  >
                    <span className="display text-[18px] leading-none text-[#15110c]" style={{ fontStretch: "72%" }}>
                      {t.label}
                    </span>
                  </span>
                  <svg
                    className="tick absolute top-3 right-3 h-[14px] w-[18px]"
                    viewBox="0 0 28 22"
                    data-on={on ? "true" : "false"}
                    aria-hidden
                  >
                    <path d="M3 12.5 L10.5 19 L25 3.5" fill="none" stroke="#15110c" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 px-4" style={{ paddingBottom: "calc(var(--safe-bottom, env(safe-area-inset-bottom)) + 14px)" }}>
        <div className="chrome mx-auto flex max-w-[460px] items-center gap-2 rounded-full p-1.5">
          <button
            type="button"
            onClick={() => save([])}
            disabled={saving}
            className="pill label px-4 text-[14px] text-muted"
          >
            {edit ? "Clear" : "Skip"}
          </button>
          <button
            type="button"
            onClick={() => save([...picked])}
            disabled={!ready || saving}
            className="pill label ml-auto bg-accent px-5 py-3 text-[15px] text-accent-ink transition-opacity disabled:opacity-45"
          >
            {saving ? "Saving…" : ready ? (edit ? "Save topics" : "Start reading") : `Pick ${MIN - picked.size} more`}
          </button>
        </div>
      </div>
    </>
  );
}
