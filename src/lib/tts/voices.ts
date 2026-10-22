/**
 * The one natural (online) voice, from Azure's free neural tier. Every card's
 * audio is made in it once and reused; the phone's own voice is only a fallback.
 */
export const NATURAL_VOICES = [{ id: "en-IN-NeerjaNeural", label: "Neerja (Indian English)" }] as const;

export type NaturalVoiceId = (typeof NATURAL_VOICES)[number]["id"];

export const DEFAULT_NATURAL: NaturalVoiceId = "en-IN-NeerjaNeural";
export const NATURAL_PREFIX = "azure:";
export const SAMPLE_TEXT = "This is how your ideas will sound.";

export function isNaturalVoice(id: string | null | undefined): id is NaturalVoiceId {
  return !!id && NATURAL_VOICES.some((v) => v.id === id);
}

export function naturalLabel(id: string): string {
  return NATURAL_VOICES.find((v) => v.id === id)?.label.split(" (")[0] ?? id;
}
