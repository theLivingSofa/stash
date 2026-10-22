"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled.",
  bad_state: "That sign-in link expired. Try again.",
  google_failed: "Google sign-in didn't work. Try again in a moment.",
  unverified_email: "That Google account's email isn't verified.",
  google_not_configured: "Google sign-in isn't set up yet. Use the passcode.",
};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const urlError = sp.get("error");
  const [showPasscode, setShowPasscode] = useState(urlError === "google_not_configured");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(urlError ? (ERRORS[urlError] ?? ERRORS.google_failed) : null);
  const [busy, setBusy] = useState(false);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

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
      router.replace(safeNext);
      router.refresh();
    } catch {
      setError("Couldn't reach Stash. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-9 space-y-4">
      <a
        href={`/api/auth/google?next=${encodeURIComponent(safeNext)}`}
        className="label flex w-full items-center justify-center gap-3 rounded-full bg-accent px-4 py-3.5 text-[16.5px] text-accent-ink shadow-[0_10px_24px_-10px_var(--accent)]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
          <GoogleMark />
        </span>
        Continue with Google
      </a>

      {error ? (
        <p id="login-error" className="text-[14px] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showPasscode ? (
        <form onSubmit={submit} className="space-y-3 pt-2">
          <label htmlFor="passcode" className="block text-[14px] text-muted">
            Owner passcode
          </label>
          <input
            id="passcode"
            name="passcode"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            className="field-input text-[17px]"
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />
          <button
            type="submit"
            disabled={busy}
            className="label w-full rounded-full border border-line bg-surface-2 px-4 py-3.5 text-[16px] disabled:opacity-60"
          >
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setShowPasscode(true)} className="label block w-full pt-1 text-center text-[14px] text-muted underline-offset-4 hover:underline">
          Use the passcode instead
        </button>
      )}
    </div>
  );
}
