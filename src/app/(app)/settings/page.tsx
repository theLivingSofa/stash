"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/lib/client/settings";
import { activeVoiceLabel, canSpeak, rankedVoices, speak, voiceQuality } from "@/lib/client/speak";
import { toast } from "@/components/Toast";
import { clearDeviceData } from "@/lib/client/cache";

export default function SettingsPage() {
  const router = useRouter();
  const [s, update] = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const speechOk = useSyncExternalStore(noopSubscribe, canSpeak, () => false);
  const me = useMe();

  useEffect(() => {
    if (!canSpeak()) return;
    const load = () => setVoices(rankedVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const d = await res.json();
      toast(res.ok ? d.message : "Couldn't start a refresh. Try again shortly.");
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    await clearDeviceData();
    router.replace("/login");
  }

  const row = "flex items-center justify-between gap-4 border-b border-line px-1 py-4";
  const seg = (on: boolean) => `label rounded-full px-3 py-1.5 text-[14px] ${on ? "bg-accent text-accent-ink" : "text-muted"}`;

  return (
    <div className="page-scroll px-4 pt-1">
      <h1 className="sr-only">Settings</h1>
      <div className="glass rounded-[26px] px-4 pb-1" style={{ ["--light" as string]: "var(--accent)" }}>
      <Account me={me} />

      <div className={row}>
        <span>
          <span className="block text-[15px]">Theme</span>
          {s.theme === "auto" ? <span className="block whitespace-nowrap text-[13px] text-muted">Follows your device</span> : null}
        </span>
        <div className="flex rounded-full bg-surface-2 p-1" role="group" aria-label="Theme">
          {(["auto", "dark", "light"] as const).map((t) => (
            <button key={t} type="button" className={seg(s.theme === t)} aria-pressed={s.theme === t} onClick={() => update({ theme: t })}>
              {t === "auto" ? "Auto" : t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-line px-1 py-4">
        <label htmlFor="font-size" className="flex items-center justify-between text-[15px]">
          Text size <span className="text-[13px] text-muted">{Math.round(s.fontScale * 100)}%</span>
        </label>
        <input
          id="font-size"
          type="range"
          min={0.85}
          max={1.3}
          step={0.05}
          value={s.fontScale}
          onChange={(e) => update({ fontScale: Number(e.target.value) })}
          className="mt-3 w-full accent-[var(--accent)]"
        />
        <p className="mt-2 font-serif text-[calc(17px*var(--font-scale))] leading-relaxed">The quick idea jumps over the lazy assumption.</p>
      </div>

      <div className={row}>
        <span>
          <span className="block text-[15px]">One card at a time</span>
          <span className="block text-[13px] text-muted">Turn off for free scrolling</span>
        </span>
        <Switch on={s.snap} onChange={(snap) => update({ snap })} label="One card at a time" />
      </div>

      {speechOk ? (
        <div className="border-b border-line px-1 py-4">
          <label htmlFor="voice" className="block text-[15px]">
            Read-aloud voice
          </label>
          <div className="mt-2 flex gap-2">
            <select
              id="voice"
              value={s.voice ?? ""}
              onChange={(e) => update({ voice: e.target.value || null })}
              className="field-input compact min-w-0 flex-1"
            >
              <option value="">Automatic (most natural installed)</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {voiceQuality(v) && !v.name.toLowerCase().includes(voiceQuality(v)!.toLowerCase()) ? ` (${voiceQuality(v)})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pill label rounded-xl border border-line px-3.5 text-[14px]"
              onClick={() =>
                speak("This is how your ideas will sound.", {
                  voice: s.voice,
                  rate: s.rate,
                  onFail: () => toast("Read-aloud didn't start. On iPhone, turn off Silent mode and check the volume, then try again."),
                })
              }
            >
              Test
            </button>
          </div>
          {voices.length > 0 ? (
            <p className="mt-2 text-[13px] text-muted">
              Reading with: <span className="text-text">{activeVoiceLabel(s.voice) ?? "system default"}</span>
            </p>
          ) : null}
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Hearing nothing on iPhone? Silent mode can mute read-aloud. Turn it off (Control Center or the side switch /
            Action button) and check the volume.
          </p>
          {voices.length > 0 && !voiceQuality(voices[0]) ? (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              On iPhone, web apps can only use the voices that come with the phone. Voices you download in Settings
              (Premium or Enhanced) don&apos;t show up here, so pick the one you like best from the list above.
            </p>
          ) : null}
          <label htmlFor="rate" className="mt-3 flex items-center justify-between text-[13px] text-muted">
            Speed <span>{s.rate.toFixed(1)}×</span>
          </label>
          <input id="rate" type="range" min={0.7} max={1.6} step={0.1} value={s.rate} onChange={(e) => update({ rate: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
        </div>
      ) : null}

      <div className={row}>
        <span>
          <span className="block text-[15px]">Fetch new ideas now</span>
          <span className="block text-[13px] text-muted">Normally this happens every 30 minutes</span>
        </span>
        <button type="button" onClick={refreshNow} disabled={refreshing} className="pill label shrink-0 border border-line disabled:opacity-60">
          {refreshing ? "Starting…" : "Refresh now"}
        </button>
      </div>

      {me?.role === "owner" ? (
      <Link href="/admin" className={`${row} text-[15px]`}>
        <span>
          <span className="block">Behind the scenes</span>
          <span className="block text-[13px] text-muted">Buffer, sources, AI providers</span>
        </span>
        <span className="text-muted" aria-hidden>
          ›
        </span>
      </Link>
      ) : null}

      </div>

      <button type="button" onClick={logout} className="pill label chrome mx-auto mt-6 flex text-[15px] text-danger">
        Log out
      </button>
    </div>
  );
}

const noopSubscribe = () => () => {};

interface Me {
  email: string | null;
  name: string | null;
  avatar: string | null;
  role: "owner" | "member";
  via: "google" | "passcode";
}

function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);
  return me;
}

function Account({ me }: { me: Me | null }) {
  if (!me) return <div className="h-[68px] border-b border-line" aria-hidden />;
  return (
    <div className="flex items-center gap-3 border-b border-line px-1 py-4">
      {me.avatar ? (
        // Google profile photo; tiny, so a plain img keeps it simple.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={me.avatar} alt="" width={36} height={36} referrerPolicy="no-referrer" className="h-9 w-9 rounded-full" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 font-serif text-[16px]" aria-hidden>
          {(me.name ?? me.email ?? "S").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[15px]">{me.name ?? (me.via === "passcode" ? "Owner (passcode)" : "Signed in")}</span>
        <span className="block truncate text-[13px] text-muted">{me.email ?? "Signed in with the passcode"}</span>
      </span>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${on ? "border-accent bg-accent" : "border-line bg-surface-2"}`}
    >
      <span className={`absolute top-[2px] left-0 h-[22px] w-[22px] rounded-full transition-transform ${on ? "translate-x-[23px] bg-accent-ink" : "translate-x-[2px] bg-muted"}`} />
    </button>
  );
}
