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

// ---- drill addressing (client-safe) ---------------------------------------
//
// A drill key is `<source>:<ref>`. These three helpers live HERE, in the module with no
// imports at all, so a client component can address a drill without importing
// lib/pronunciation/drills.ts — which reaches the database through the findings model
// and must never enter a browser bundle. `drills.ts` imports and re-exports them, so
// there is still exactly one definition of the format.

/** The drill-source id for findings-backed drills (the only producer today). */
export const FINDING_DRILL_SOURCE = "finding";

export function drillKeyOf(source: string, sourceRef: string): string {
  return `${source}:${sourceRef}`;
}

/** The key a finding-sourced drill files its attempts and visits under. */
export function drillKeyForFinding(findingId: string): string {
  return drillKeyOf(FINDING_DRILL_SOURCE, findingId);
}

/** The studio route for a drill key — the one place that path is spelled. */
export function studioDrillPath(drillKey: string): string {
  return `/practice/learn/studio/${encodeURIComponent(drillKey)}`;
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

/** Italian read aloud runs at roughly this many characters per second — deliberately
 *  conservative, and a heuristic rather than a measurement. */
export const READ_CHARS_PER_SECOND = 14;

/**
 * The longest reference text that can be a drill, derived from the two constants above
 * (420 chars). A correction longer than this cannot be offered as a drill at all, so
 * every surface that decides "is there a drill for this?" — the studio, the pin route,
 * the Phrasebook row, AND the composer's spend clause — must agree, from this one
 * number. They previously did not, which left a long correction unspendable forever.
 */
export const MAX_DRILL_REFERENCE_CHARS = MAX_DRILL_SECONDS * READ_CHARS_PER_SECOND;

/**
 * Whether a reference text can be a drill at all: non-blank and short enough for the REST
 * short-audio path. Pure and client-safe, so the studio, the pin route, the Phrasebook row
 * and the composer all apply ONE rule.
 *
 * The composer applies it in SQL rather than by calling this function, and the two agree on
 * every input that can actually occur: `lib/compose.ts` trims the same ASCII whitespace set
 * explicitly (SQLite's bare `trim()` strips spaces only). They would still differ on exotic
 * Unicode whitespace — NBSP, form feed — which JS trims and SQLite does not; no model output
 * carries it, and the divergence is named here rather than claimed away.
 */
export function drillFitsShortAudio(referenceText: string): boolean {
  const text = referenceText.trim();
  return text !== "" && text.length <= MAX_DRILL_REFERENCE_CHARS;
}

// ---- the drill gate -------------------------------------------------------

export interface DrillGateState {
  /** The native rendition has finished playing at least once. */
  heard: boolean;
  /** The rendition could not be played at all (budget refusal or a failed render). */
  renditionUnavailable: boolean;
  /**
   * This server CANNOT render the reference line at all — no voice is configured, so no
   * amount of waiting or retrying will ever produce one (E-39 §B4).
   *
   * This is a different fact from `renditionUnavailable`, and the difference is the whole
   * repair. When a rendition is merely refused or failed, hearing it later is possible and
   * a visit must keep waiting for that. When the server has no voice, "hear the line
   * first" is a condition that can never be met — so the drill's premise reduces to what
   * IS available (the written guidance, the recording, the playback), and that reduced
   * loop has to be able to complete. Otherwise the pronunciation finding gets no card
   * either (`UNCARDABLE_CATEGORIES`) and re-enters the daily plan every day forever, with
   * no action in the product that can ever clear it. [RETRO-004 §DE-4]
   */
  renditionImpossible: boolean;
}

export interface DrillGate {
  /** May the learner record? */
  canRecord: boolean;
  /** Does completing a lap count as a VISIT — i.e. may it spend the finding? */
  visitCounts: boolean;
}

/**
 * The two decisions the drill page makes, in one pure place — because getting their
 * INTERACTION wrong is what shipped a defect once already.
 *
 * `canRecord` is deliberately permissive: when the rendition cannot be played (a
 * monthly-cap refusal is a normal operating condition here — the reference is a billed
 * TTS render under the same cap), the learner may still record and hear themselves
 * back. Taking that away would leave them with a dead page.
 *
 * `visitCounts` is deliberately strict: a visit is what RETIRES the correction from the
 * daily plan, permanently, and the reference comparison IS the drill. Recording without
 * ever hearing the correct line is "say a sentence you were never shown how to say" — it
 * is practice worth allowing, but it must never spend the finding. So an unheard lap
 * unlocks practice and records nothing.
 *
 * [E-39 §B4] …with ONE exception, and it is an exception about IMPOSSIBILITY, not about
 * failure. When the server cannot render the reference line at all — no voice configured —
 * "hear it first" is a condition no learner can ever satisfy here. A pronunciation finding
 * has no card path, so the studio visit is its only retirement route, and the finding
 * re-entered the daily plan every day forever with no action that could clear it. On such
 * a server the drill is what remains available (read the guidance, say it, hear yourself
 * back) and completing THAT retires it.
 *
 * The two directions this deliberately does NOT do, because each is the mirror defect:
 *   * It does not fire on a merely FAILED or budget-REFUSED rendition. Those can succeed
 *     later, so a visit keeps waiting — retiring a drill the learner never heard, on a
 *     server that could have played it, is the E-37 defect this same gate was built to
 *     stop, and it stays stopped.
 *   * It does not turn on a CLIENT-side failure. `renditionImpossible` comes from the
 *     server's own report of its configuration, so a flaky network cannot manufacture it.
 *
 * The trio is exported and tested as a truth table so the permissive and the strict
 * decisions can never silently be conflated again.
 */
export function drillGate(state: DrillGateState): DrillGate {
  return {
    canRecord: state.heard || state.renditionUnavailable || state.renditionImpossible,
    visitCounts: state.heard || state.renditionImpossible,
  };
}

/**
 * Should playing this take back REPORT a lap? Extracted from the recorder's ref so the
 * decision is a truth table rather than a mutation buried in a component.
 *
 * `alreadyReported` is the per-take latch: one lap per recording, so "Said N×" counts
 * real laps and not button presses. `canReport` is whether the parent is accepting laps
 * at all (it passes no callback while the line has not been heard — `drillGate`).
 *
 * The subtlety that shipped a defect: the latch must only be SPENT when the lap can
 * actually be reported. Burning it on a lap the parent is ignoring meant a learner who
 * pressed "Hear yours" during a blind practice lap could then hear the line, compare
 * properly, and have that lap silently dropped — the correction never spendable without
 * re-recording. So a lap that cannot report must leave the latch untouched.
 */
export function shouldReportLap(state: { canReport: boolean; alreadyReported: boolean }): boolean {
  return state.canReport && !state.alreadyReported;
}
