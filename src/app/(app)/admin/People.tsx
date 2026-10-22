"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/Toast";

type Sort = "new" | "old" | "az" | "za";
interface Counts {
  allowed: number;
  pending: number;
  readers: number;
}
interface Request {
  email: string;
  name: string | null;
  note: string | null;
  requested_at: string;
}
interface Allowed {
  email: string;
  added_at: string;
}
interface Reader {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  last_active_at: string | null;
  seen: number;
  saved: number;
}
interface PeopleData {
  counts: Counts;
  requests: Request[];
  allowed: { items: Allowed[]; total: number; nextOffset: number | null };
  users: Reader[];
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never";

const btn = "rounded-full border border-line px-3 py-1.5 text-[13px] disabled:opacity-50";

async function peopleAction(action: "approve" | "deny" | "add" | "remove", email: string) {
  const res = await fetch("/api/admin/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, email }),
  });
  const r = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(r.error ?? "That didn't work.");
  toast(
    action === "approve" || action === "add"
      ? `${email} can now sign in with Google`
      : action === "deny"
        ? "Request denied"
        : `${email} can no longer sign in`,
  );
}

/** Behind the scenes: who can sign in, counts, and a way into the People page. */
export function PeopleSummary() {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    fetch("/api/admin/people?summary=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: { counts: Counts } | null) => x && setCounts(x.counts))
      .catch(() => {});
  }, []);

  return (
    <section id="people" className="glass mt-3 scroll-mt-4 rounded-[22px] p-4">
      <h2 className="mb-3 text-[15px] font-medium">People</h2>
      <AccessSwitch />
      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Approved", counts?.allowed],
          ["Waiting", counts?.pending],
          ["Readers", counts?.readers],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="font-serif text-[20px]">{v ?? "–"}</dd>
          </div>
        ))}
      </dl>
      <Link href="/admin/people" className="pill label mt-3 inline-flex border border-line text-[14px]">
        Manage people
        {counts?.pending ? (
          <span className="ml-1 rounded-full bg-accent px-1.5 text-[12px] text-accent-ink">{counts.pending} waiting</span>
        ) : null}
        <span aria-hidden>›</span>
      </Link>
    </section>
  );
}

/** The People page: requests, approved emails (search + sort), readers. */
export function PeopleManager({ initialTab = "approved" }: { initialTab?: "approved" | "requests" | "readers" }) {
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [d, setD] = useState<PeopleData | null>(null);
  const [items, setItems] = useState<Allowed[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const req = useRef(0);

  const load = useCallback(
    async (offset = 0) => {
      const id = ++req.current;
      const params = new URLSearchParams({ q, sort, offset: String(offset), limit: "50" });
      const r = await fetch(`/api/admin/people?${params}`, { cache: "no-store" });
      if (r.status === 403) return setDenied(true);
      if (!r.ok || id !== req.current) return;
      const x = (await r.json()) as PeopleData;
      setD(x);
      setItems((prev) => (offset === 0 ? x.allowed.items : [...prev, ...x.allowed.items]));
      setNext(x.allowed.nextOffset);
    },
    [q, sort],
  );

  // Search waits for typing to pause; sort applies at once.
  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function act(action: "approve" | "deny" | "add" | "remove", target: string) {
    setBusy(`${action}:${target}`);
    try {
      await peopleAction(action, target);
      if (action === "add") setEmail("");
      setConfirm(null);
      await load(0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  if (denied) return <p className="p-6 text-danger">Only the owner can see this page.</p>;

  const counts = d?.counts;
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === k}
      onClick={() => setTab(k)}
      className={`label rounded-full px-3.5 py-1.5 text-[14px] ${tab === k ? "bg-accent text-accent-ink" : "chrome text-text"}`}
    >
      {label}
      {n != null ? <span className="tabular ml-1 opacity-75">{n}</span> : null}
    </button>
  );

  return (
    <div className="page-scroll px-4 pt-1 text-[14px]">
      <Link href="/admin" className="pill label chrome mb-3 inline-flex text-muted">
        <span aria-hidden>‹</span> Behind the scenes
      </Link>
      <h1 className="display mb-4 px-1 text-[30px] leading-none">People</h1>

      <section className="glass mb-3 rounded-[22px] p-4">
        <AccessSwitch bare />
      </section>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="People">
        {tabBtn("approved", "Approved", counts?.allowed)}
        {tabBtn("requests", "Requests", counts?.pending)}
        {tabBtn("readers", "Readers", counts?.readers)}
      </div>

      {tab === "approved" ? (
        <section className="glass rounded-[22px] p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void act("add", email.trim());
            }}
            className="mb-4 flex gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Add an email, e.g. friend@gmail.com"
              aria-label="Email to approve"
              className="field-input compact min-w-0 flex-1"
            />
            <button type="submit" className={btn} disabled={!!busy || !email.trim()}>
              Add
            </button>
          </form>

          <div className="mb-3 flex gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search emails"
              aria-label="Search approved emails"
              className="field-input compact min-w-0 flex-1"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort"
              className="field-input compact shrink-0"
              style={{ width: "auto" }}
            >
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="az">A to Z</option>
              <option value="za">Z to A</option>
            </select>
          </div>

          <p className="mb-2 text-[12px] text-muted">
            {d ? (q ? `${d.allowed.total} matching` : `${d.allowed.total} approved`) : "Loading…"}
          </p>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">{a.email}</span>
                    <span className="block text-[12px] text-muted">Added {when(a.added_at)}</span>
                  </span>
                  {confirm === a.email ? (
                    <span className="flex shrink-0 gap-2">
                      <button type="button" className={`${btn} text-danger`} disabled={!!busy} onClick={() => act("remove", a.email)}>
                        Remove
                      </button>
                      <button type="button" className={btn} onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="shrink-0 text-[13px] text-danger" onClick={() => setConfirm(a.email)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : d ? (
            <p className="text-muted">{q ? "No approved email matches that." : "Only you, so far."}</p>
          ) : null}
          {next != null ? (
            <button type="button" className={`${btn} mt-3 w-full`} onClick={() => void load(next)}>
              Show more
            </button>
          ) : null}
        </section>
      ) : null}

      {tab === "requests" ? (
        <section className="glass rounded-[22px] p-4">
          {d?.requests.length ? (
            <ul className="divide-y divide-line">
              {d.requests.map((r) => (
                <li key={r.email} className="py-3">
                  <div>{r.name ?? r.email}</div>
                  <div className="text-[12px] text-muted">
                    {r.name ? `${r.email} · ` : ""}asked {when(r.requested_at)}
                  </div>
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
            <p className="text-muted">{d ? "No one is waiting." : "Loading…"}</p>
          )}
        </section>
      ) : null}

      {tab === "readers" ? (
        <section className="glass rounded-[22px] p-4">
          <ul className="divide-y divide-line">
            {[...(d?.users ?? [])]
              .sort((a, b) => (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""))
              .map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate">
                      {u.name ?? u.email ?? "Owner"}
                      {u.role === "owner" ? <span className="text-muted"> (you)</span> : null}
                    </span>
                    {u.name && u.email ? <span className="block truncate text-[12px] text-muted">{u.email}</span> : null}
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-muted">
                    {u.seen} read · {u.saved} saved
                    <br />
                    active {when(u.last_active_at)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Who can sign in with Google: approved people only, or anyone. */
function AccessSwitch({ bare = false }: { bare?: boolean }) {
  const [mode, setMode] = useState<"invite" | "open" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/access", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((x: { mode: "invite" | "open" } | null) => x && setMode(x.mode))
      .catch(() => {});
  }, []);

  async function choose(next: "invite" | "open") {
    if (next === mode || saving) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!r.ok) throw new Error();
      setMode(next);
      toast(next === "open" ? "Stash is open: anyone with Google can sign in." : "Back to approved people only.");
    } catch {
      toast("Couldn't change who can sign in. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!mode) return null;
  const seg = (on: boolean) => `label rounded-full px-3 py-1.5 text-[13.5px] ${on ? "bg-accent text-accent-ink" : "text-muted"}`;
  return (
    <div className={bare ? "" : "mb-4 border-b border-line pb-4"}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px]">Who can sign in</span>
        <div className="flex rounded-full bg-surface-2 p-1" role="group" aria-label="Who can sign in">
          <button type="button" className={seg(mode === "invite")} aria-pressed={mode === "invite"} disabled={saving} onClick={() => choose("invite")}>
            Approved only
          </button>
          <button type="button" className={seg(mode === "open")} aria-pressed={mode === "open"} disabled={saving} onClick={() => choose("open")}>
            Anyone
          </button>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        {mode === "open"
          ? "Anyone with a Google account can sign in and is added to the approved list. Switching back keeps them; remove anyone you don't want. More readers use more of the free AI and voice allowances."
          : "Only approved emails can sign in. Others can request access, and you get an email."}
      </p>
    </div>
  );
}
