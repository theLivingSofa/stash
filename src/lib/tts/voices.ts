/**
 * Natural (online) voices from Azure's free neural tier. Settings stores the
 * choice as "azure:<id>" in the same field as on-device voice names.
 */
export const NATURAL_VOICES = [
  { id: "en-IN-NeerjaNeural", label: "Neerja (Indian English)" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat (Indian English)" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (American)" },
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (American)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (British)" },
  { id: "en-GB-RyanNeural", label: "Ryan (British)" },
] as const;

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
