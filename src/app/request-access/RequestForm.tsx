"use client";

import Link from "next/link";
import { useState } from "react";

export function RequestForm() {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't send the request.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="mt-8 space-y-4" role="status">
        <p className="rounded-2xl bg-surface-2 px-4 py-3.5 text-[15px] leading-relaxed">
          Request sent. You&apos;ll be able to sign in once it&apos;s approved. Try &ldquo;Continue with Google&rdquo; again later.
        </p>
        <Link href="/login" className="block text-center text-[14px] text-muted underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="mt-8 space-y-3">
      <label htmlFor="note" className="block text-[14px] text-muted">
        Add a note (optional)
      </label>
      <textarea
        id="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        rows={3}
        placeholder="Hey, it's me from…"
        className="field-input resize-none"
      />
      {error ? (
        <p className="text-[14px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="label w-full rounded-full bg-accent px-4 py-3.5 text-[16px] text-accent-ink disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Request access"}
      </button>
      <Link href="/login" className="block pt-1 text-center text-[14px] text-muted underline-offset-4 hover:underline">
        Use a different Google account
      </Link>
    </form>
  );
}
