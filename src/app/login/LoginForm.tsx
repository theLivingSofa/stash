"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "That passcode didn't work.");
        setBusy(false);
        return;
      }
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.replace(dest);
      router.refresh();
    } catch {
      setError("Couldn't reach Stash. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-3">
      <label htmlFor="passcode" className="block text-[14px] text-muted">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        className="w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-[17px] outline-none focus:border-accent"
        aria-invalid={!!error}
        aria-describedby={error ? "login-error" : undefined}
      />
      {error ? (
        <p id="login-error" className="text-[14px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-accent px-4 py-3.5 text-[16px] font-medium text-accent-ink disabled:opacity-60"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </form>
  );
}
