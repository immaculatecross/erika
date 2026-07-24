// The PARSED Azure Pronunciation Assessment result (E-37, D-21). Client-safe: pure
// types and tick arithmetic, no I/O, no secrets.
//
// This shape — not the HTTP call — is the adapter boundary (WO criterion 1): every
// consumer (the studio view, the knowledge writes, the tests) speaks in these types,
// so the live Azure REST client and the committed fixture scorer are interchangeable
// and no test ever needs egress.
//
// WHAT it-IT ACTUALLY RETURNS (OBS-002, live-verified 2026-07-24 — do not re-derive):
// AccuracyScore at full-text / word / PHONEME granularity, FluencyScore,
// CompletenessScore (scripted only), PronScore, a word-level ErrorType, per-word and
// per-phoneme Offset+Duration in 100-ns ticks, and NBestPhonemeCount phoneme
// alternates with confidence.
//
// WHAT IT DOES NOT RETURN FOR ITALIAN: **no ProsodyScore and no syllable groups** —
// both are `en-US` only, and therefore so are the prosody-derived error types
// (Monotone / UnexpectedBreak / MissingBreak). There is deliberately NO prosody field
// in this file, and `EnableProsodyAssessment` is never set (it yields nothing for
// it-IT and is the only add-on-billed score). No intonation or rhythm number may
// appear anywhere in the Italian UI; that feedback stays on the LLM-flag side of D-21.

/** Word-level error types Azure returns for it-IT. The prosody-derived types
 *  (Monotone / UnexpectedBreak / MissingBreak) are en-US only and absent here. */
export const PRONUNCIATION_ERROR_TYPES = ["None", "Mispronunciation", "Omission", "Insertion"] as const;
export type PronunciationErrorType = (typeof PRONUNCIATION_ERROR_TYPES)[number];

export function isPronunciationErrorType(x: unknown): x is PronunciationErrorType {
  return typeof x === "string" && (PRONUNCIATION_ERROR_TYPES as readonly string[]).includes(x);
}

/** One phoneme the model considered as an alternative to the expected one, with its
 *  confidence. This is the single most useful field for Italian feedback: it is what
 *  lets the studio say "you produced /l/ where /ʎ/ was expected" instead of "wrong". */
export interface PhonemeAlternate {
  phoneme: string;
  score: number;
}

export interface PronouncedPhoneme {
  /** The EXPECTED phoneme, as Azure's phoneme alphabet renders it. */
  phoneme: string;
  accuracyScore: number;
  /** Offset into the learner's own audio, in 100-ns ticks. */
  offsetTicks: number;
  durationTicks: number;
  /** `NBestPhonemeCount` alternates, best first. Empty when the service returned none. */
  nBest: PhonemeAlternate[];
}

export interface PronouncedWord {
  word: string;
  accuracyScore: number;
  errorType: PronunciationErrorType;
  offsetTicks: number;
  durationTicks: number;
  phonemes: PronouncedPhoneme[];
}

/** One scored take of one scripted drill — the whole adapter boundary. */
export interface PronunciationResult {
  pronScore: number;
  accuracyScore: number;
  fluencyScore: number;
  /** Scripted-only score: how much of the reference text was actually said. */
  completenessScore: number;
  /**
   * The response's signal-to-noise ratio in dB, or null when the service omitted it.
   * Azure's own Responsible AI doc states PA quality is BOUNDED by transcription
   * quality and asks for a close mic and low noise, so a noisy take produces a bad
   * score that describes the room rather than the learner. The studio uses this as a
   * re-record gate (lib/pronunciation/thresholds.ts) rather than showing a number it
   * cannot stand behind (D-19 honesty).
   */
  snrDb: number | null;
  words: PronouncedWord[];
}

/** Azure reports offsets and durations in 100-nanosecond units. */
export const TICKS_PER_MS = 10_000;

/** Ticks → milliseconds, the unit the player seeks in. */
export function ticksToMs(ticks: number): number {
  return ticks / TICKS_PER_MS;
}

/**
 * The REST short-audio path caps assessed audio at 30 seconds — the right path for
 * drills, which are one short sentence. A longer take is refused BEFORE any
 * reservation or call, so an over-long recording never costs anything.
 */
export const MAX_DRILL_SECONDS = 30;
