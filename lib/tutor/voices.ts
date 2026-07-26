// The tutor's selected voice. Client-safe pure data — no I/O — so Settings and the
// common E-48 TTS route read one list. These ten names are supported by both the
// Realtime voice contract measured in spike 7 and current gpt-4o-mini-tts; E-48 uses
// them only on TTS so both listener architectures remain voice-identical.

/**
 * The overlap between the measured Realtime enum and gpt-4o-mini-tts's documented
 * built-in voices. Keeping the existing dial avoids a second voice experiment.
 */
export const REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "marin",
  "sage",
  "shimmer",
  "verse",
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

/**
 * The default: **`alloy`**. It is the only one of the ten with any of the operator's
 * own ear behind it — they picked it out of spike-5's TTS samples ("the first and last
 * are great") — and it is deliberately not `marin`, the voice their earlier Realtime
 * verdict was formed against.
 */
export const DEFAULT_TUTOR_VOICE: RealtimeVoice = "alloy";

/** The voice `marin`, named once so the "not the judged voice" rule is checkable
 *  rather than a claim in a comment. */
export const JUDGED_VOICE: RealtimeVoice = "marin";

export function isRealtimeVoice(x: unknown): x is RealtimeVoice {
  return typeof x === "string" && (REALTIME_VOICES as readonly string[]).includes(x);
}

/** Coerce an untrusted value to a voice, falling back to the default. A database that
 *  stored the old `female`/`male` choice lands here and reads as the default — inert,
 *  never fatal. */
export function coerceTutorVoice(x: unknown): RealtimeVoice {
  return isRealtimeVoice(x) ? x : DEFAULT_TUTOR_VOICE;
}

/** The Settings label for a voice: its own name, capitalized. Nothing is claimed about
 *  how any of them sounds — this file cannot hear, and neither could the spike. */
export function voiceLabel(voice: RealtimeVoice): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}
