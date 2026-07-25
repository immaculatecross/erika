// The tutor's voice (E-43, Amendment 5). Client-safe pure data — no I/O — so Settings,
// the session config and the tests all read ONE list.
//
// WHY THIS FILE MOVED AND SHRANK. Until the operator drove the built tutor, the
// speaking leg was TTS and this list held the two `/v1/audio/speech` voices they had
// picked by ear (`alloy` and `nova`, presented as female/male). The operator then ruled
// the TTS/STT lag unacceptable and sent the speaking leg back to Realtime audio-out, so
// the voice is now a property of the Realtime session itself and belongs beside it.
//
// ⚠️ `nova` IS NOT A REALTIME VOICE. The Realtime API accepts exactly the ten below and
// rejects `nova`, `onyx` and `fable` with HTTP 400 — established from the live API's own
// enum validation, both tiers, in `docs/research/spike-7-realtime-voices.md` §1.1. So the
// operator's previous default could not be carried across; it does not exist here.
//
// ⚠️ AND THE OLD MALE/FEMALE FRAMING IS GONE WITH IT. It was the operator's ear applied
// to two specific TTS renditions; OpenAI does not label its voices by gender, and
// inventing that mapping for eight voices nobody has ruled on would be exactly the
// spec-sheet guess this whole detour exists to punish.

/**
 * Every voice `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` accept — read out of the
 * live API's own `invalid_value` error, not a datasheet (spike-7 §1.1, MEASURED), and
 * then exercised end to end: all ten produced audio on the first attempt.
 *
 * All ten are offered because the operator has not picked one. Their original verdict
 * — "it does not speak super well" — was formed against `marin` alone, the only
 * Realtime voice this repo has ever carried (pinned 2026-07-24, never changed). They
 * have since been sent Italian renditions of all ten (`artifacts/voice-samples/
 * realtime-*.mp3`) and have not named a favourite, so the dial puts the answer where
 * their ear can reach it inside the app. This is still ONE knob: it replaces the
 * two-option TTS voice dial one-for-one, so the Settings count is unchanged.
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
 * own ear behind it — they picked it out of spike-5's samples ("the first and last are
 * great") — and it is deliberately not `marin`, the single voice their "does not speak
 * super well" verdict was formed against. It is a *Realtime* rendition of alloy rather
 * than the `gpt-4o-mini-tts` one they approved, which is a different model and so a
 * different sound; that is why the dial exists.
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
