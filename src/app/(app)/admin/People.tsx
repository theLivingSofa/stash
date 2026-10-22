"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/Toast";

interface PeopleData {
  requests: { email: string; name: string | null; note: string | null; status: "pending" | "approved" | "denied"; requested_at: string }[];
  allowed: { email: string; added_at: string }[];
  users: { id: string; email: string | null; name: string | null; role: string; last_active_at: string | null; seen: number; saved: number }[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "never");

export function People() {
  const [d, setD] = useState<PeopleData | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/admin/people", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((x) => x && setD(x))
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    void load();
    if (location.hash === "#people") document.getElementById("people")?.scrollIntoView();
  }, [load]);

  async function act(action: "approve" | "deny" | "add" | "remove", target: string) {
    setBusy(`${action}:${target}`);
    try {
      const res = await fetch("/api/admin/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: target }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? "That didn't work.");
      toast(
        action === "approve" || action === "add"
          ? `${target} can now sign in with Google`
          : action === "deny"
            ? "Request denied"
            : `${target} can no longer sign in`,
      );
      if (action === "add") setEmail("");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  const card = "rounded-2xl border border-line bg-surface p-4";
  const pending = d?.requests.filter((r) => r.status === "pending") ?? [];
  const btn = "rounded-full border border-line px-3 py-1.5 text-[13px] disabled:opacity-50";

  return (
    <section id="people" className={`${card} mt-3 scroll-mt-4`}>
      <h2 className="mb-3 text-[15px] font-medium">People</h2>

      <h3 className="mb-2 text-[13px] text-muted">Asking to join ({pending.length})</h3>
      {pending.length ? (
        <ul className="mb-4 space-y-3">
          {pending.map((r) => (
            <li key={r.email} className="border-b border-line pb-3 last:border-0">
              <div className="text-[14px]">{r.name ?? r.email}</div>
              {r.name ? <div className="text-[13px] text-muted">{r.email}</div> : null}
              {r.note ? <p className="mt-1 font-serif text-[14px] text-muted">&ldquo;{r.note}&rdquo;</p> : null}
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${btn} border-accent bg-accent text-accent-ink`} disabled={!!busy} onClick={() => act("approve", r.email)}>
                  Approve
                </button>
                <button type="button" className={btn} disabled={!!busy} onClick={() => act("deny", r.email)}>
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[14px] text-muted">No one is waiting.</p>
      )}

      <h3 className="mb-2 text-[13px] text-muted">Allowed to sign in</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void act("add", email.trim());
        }}
        className="mb-3 flex gap-2"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@gmail.com"
          aria-label="Email to allow"
          className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-[14px] outline-none focus:border-accent"
        />
        <button type="submit" className={btn} disabled={!!busy || !email.trim()}>
          Add
        </button>
      </form>
      {d?.allowed.length ? (
        <ul className="mb-4 space-y-1.5">
          {d.allowed.map((a) => (
            <li key={a.email} className="flex items-center justify-between gap-2 text-[14px]">
              <span className="truncate">{a.email}</span>
              <button type="button" className="shrink-0 text-[13px] text-danger" disabled={!!busy} onClick={() => act("remove", a.email)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[14px] text-muted">Only you, so far.</p>
      )}

      <h3 className="mb-2 text-[13px] text-muted">Readers</h3>
      <ul className="space-y-1.5">
        {(d?.users ?? []).map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 text-[14px]">
            <span className="min-w-0 truncate">
              {u.name ?? u.email ?? "Owner"}
              {u.role === "owner" ? <span className="text-muted"> (you)</span> : null}
            </span>
            <span className="shrink-0 text-[13px] text-muted">
              {u.seen} read · {u.saved} saved · {when(u.last_active_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
