"use client";

import { useEffect, useState } from "react";

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function toast(msg: string) {
  listeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const l: Listener = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 2600);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(t);
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(var(--dock-space) + 6px)" }}
    >
      {msg ? (
        <div className="chrome label rounded-full px-4 py-2.5 text-[14px] text-text">{msg}</div>
      ) : null}
    </div>
  );
}
