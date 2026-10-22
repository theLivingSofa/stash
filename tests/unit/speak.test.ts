import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Minimal fake of the Web Speech API, enough to check our iOS-safe behaviour. */
class FakeUtterance {
  lang = "";
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

function installFake(opts: { speaking?: boolean; starts?: boolean }) {
  const calls: string[] = [];
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: !!opts.speaking,
    pending: false,
    paused: false,
    getVoices: () => [{ name: "Samantha", lang: "en-US" }],
    cancel: () => {
      calls.push("cancel");
      synth.speaking = false;
    },
    speak: (u: FakeUtterance) => {
      calls.push("speak");
      spoken.push(u);
      if (opts.starts && spoken.length === 1) {
        synth.speaking = true;
        queueMicrotask(() => u.onstart?.());
      }
    },
    resume: () => calls.push("resume"),
  };
  vi.stubGlobal("window", { speechSynthesis: synth, setTimeout: globalThis.setTimeout });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return { calls, spoken, synth };
}

describe("speak (iOS-safe)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const longText = Array.from({ length: 10 }, (_, i) => `This is sentence ${i}, which carries part of the idea.`).join(" ");

  it("does not call cancel() right before speak() when nothing is playing", async () => {
    const { calls, spoken } = installFake({ starts: true });
    const { speak } = await import("@/lib/client/speak");
    speak(longText, {});
    expect(calls[0]).toBe("speak");
    expect(calls).not.toContain("cancel");
    expect(spoken.length).toBeGreaterThan(1); // chunked
    expect(spoken.every((u) => u.lang === "en-US")).toBe(true);
  });

  it("stops current speech before starting a new card", async () => {
    const { calls } = installFake({ speaking: true, starts: true });
    const { speak } = await import("@/lib/client/speak");
    speak("Hello there.", {});
    expect(calls.slice(0, 2)).toEqual(["cancel", "speak"]);
  });

  it("uses the chosen voice and its language", async () => {
    const { spoken } = installFake({ starts: true });
    const { speak } = await import("@/lib/client/speak");
    speak("Hello there.", { voice: "Samantha", rate: 1.2 });
    expect(spoken[0].voice).toEqual({ name: "Samantha", lang: "en-US" });
    expect(spoken[0].rate).toBe(1.2);
  });

  it("reports start, and end only after the last chunk", async () => {
    const { spoken } = installFake({ starts: true });
    const { speak } = await import("@/lib/client/speak");
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speak(longText, { onStart, onEnd });
    await Promise.resolve();
    expect(onStart).toHaveBeenCalledTimes(1);
    spoken[0].onend?.();
    expect(onEnd).not.toHaveBeenCalled();
    spoken[spoken.length - 1].onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("calls onFail when speech never starts (e.g. iPhone muted it)", async () => {
    installFake({ starts: false });
    const { speak } = await import("@/lib/client/speak");
    const onFail = vi.fn();
    speak("Hello there.", { onFail });
    vi.advanceTimersByTime(2600);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it("does not report failure after the reader stops it", async () => {
    installFake({ starts: false });
    const { speak, stopSpeaking } = await import("@/lib/client/speak");
    const onFail = vi.fn();
    speak("Hello there.", { onFail });
    stopSpeaking();
    vi.advanceTimersByTime(3000);
    expect(onFail).not.toHaveBeenCalled();
  });
});

describe("voice ranking", () => {
  it("prefers premium/enhanced/natural English voices and never picks novelty voices", async () => {
    const { voiceScore } = await import("@/lib/client/speak");
    const voices = [
      { name: "Albert", lang: "en-US" },
      { name: "Samantha", lang: "en-US" },
      { name: "Ava (Premium)", lang: "en-US" },
      { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US" },
      { name: "Thomas", lang: "fr-FR" },
    ];
    const sorted = [...voices].sort((a, b) => voiceScore(b) - voiceScore(a));
    expect(sorted[0].name).toBe("Ava (Premium)");
    expect(voiceScore({ name: "Albert", lang: "en-US" })).toBeLessThan(voiceScore({ name: "Samantha", lang: "en-US" }));
    expect(voiceScore({ name: "Thomas", lang: "fr-FR" })).toBeLessThan(-50);
  });
});

describe("iOS media routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it("switches the audio session to playback and plays a silent clip inside the tap", async () => {
    const played: string[] = [];
    const session = { type: "auto" };
    vi.stubGlobal("navigator", { audioSession: session });
    vi.stubGlobal(
      "Audio",
      class {
        volume = 1;
        constructor(public src: string) {}
        setAttribute() {}
        play() {
          played.push(this.src.slice(0, 22));
          return Promise.resolve();
        }
      },
    );
    const { preferMediaAudio } = await import("@/lib/client/speak");
    preferMediaAudio();
    expect(session.type).toBe("playback");
    expect(played).toEqual(["data:audio/wav;base64,"]);
  });
  it("is a harmless no-op where unsupported", async () => {
    vi.stubGlobal("navigator", {});
    const { preferMediaAudio } = await import("@/lib/client/speak");
    expect(() => preferMediaAudio()).not.toThrow();
  });
});
