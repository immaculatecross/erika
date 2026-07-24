// Score → feedback thresholds for the pronunciation studio (E-37). Client-safe.
//
// THESE ARE CHOICES, NOT MEASUREMENTS — and they will stay choices.
//
// Microsoft explicitly tells customers to pick their own thresholds per scenario and
// validate them on real target-scenario data. For Italian that validation is not
// merely "pending": **there is no labelled Italian pronunciation-assessment corpus in
// existence**, open or commercial. Every GOP / mispronunciation-detection benchmark
// in the field (speechocean762, L2-ARCTIC, TIMIT, Buckeye, EpaDB) is English. So the
// numbers below are transferred from English-language norms and hand-tuned; nobody —
// including us, including after an operator supplies a live `AZURE_SPEECH_KEY` — can
// validate them against Italian ground truth without first building a labelled
// Italian learner set that does not exist today.
//
// Consequences, and they are binding on the UI copy (D-19 honesty):
//   * what the studio shows is **Azure's model output**, not a validated measurement
//     of Italian pronunciation;
//   * the good / shaky bands are **our own tunable choices**, not empirical findings;
//   * a live key buys REAL FIXTURES, not validation.
//
// Every number here is therefore a documented, env-overridable knob — never a magic
// constant buried in a component (WO criterion 5). Defaults sit in one place so a
// future calibration is one edit.

export interface PronunciationThresholds {
  /** At or above this per-unit accuracy score, a word/phoneme reads as good. */
  good: number;
  /** Below this per-unit accuracy score, a word/phoneme reads as off. Between the
   *  two it is "shaky" — worth another go, not worth alarm. */
  shaky: number;
  /** At or above this whole-utterance PronScore the take counts as passing (the only
   *  gate that may mint cued evidence). */
  pass: number;
  /** Below this signal-to-noise ratio (dB) the take is treated as unhearable: the
   *  studio shows a re-record prompt and NO scores. */
  minSnrDb: number;
}

/**
 * The defaults. `good`/`shaky` split Azure's 0–100 HundredMark scale at the
 * conventional 80/60 marks used in English-language PA integrations — a transfer, not
 * a finding. `pass` matches `good` so "this take was good" and "this word was good"
 * mean the same thing to a learner. `minSnrDb` is a hand-picked floor: clean
 * close-mic speech lands well above 20 dB in practice, so 10 dB flags a genuinely bad
 * room or a distant mic without rejecting ordinary takes. It is the least evidenced
 * number here and the first one to re-tune against real takes.
 */
export const DEFAULT_PRONUNCIATION_THRESHOLDS: PronunciationThresholds = {
  good: 80,
  shaky: 60,
  pass: 80,
  minSnrDb: 10,
};

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The live thresholds, each overridable by env so an operator can re-tune without a
 * deploy: `PRON_GOOD_SCORE`, `PRON_SHAKY_SCORE`, `PRON_PASS_SCORE`, `PRON_MIN_SNR_DB`.
 * An unset or unparseable value falls back to the documented default — a bad env var
 * can never silently disable a gate.
 */
export function pronunciationThresholds(
  env: Record<string, string | undefined> = process.env,
): PronunciationThresholds {
  const d = DEFAULT_PRONUNCIATION_THRESHOLDS;
  return {
    good: num(env.PRON_GOOD_SCORE, d.good),
    shaky: num(env.PRON_SHAKY_SCORE, d.shaky),
    pass: num(env.PRON_PASS_SCORE, d.pass),
    minSnrDb: num(env.PRON_MIN_SNR_DB, d.minSnrDb),
  };
}

/** How a single accuracy score reads. Three bands only — the palette carries meaning
 *  (D-14), and a fourth band would be decoration. */
export type ScoreBand = "good" | "shaky" | "off";

export function scoreBand(score: number, t: PronunciationThresholds): ScoreBand {
  if (score >= t.good) return "good";
  if (score >= t.shaky) return "shaky";
  return "off";
}

/** Whether a take is too noisy to score honestly. A null SNR (the service omitted
 *  it) is NOT treated as noisy — we do not invent a reason to withhold a score. */
export function isTooNoisy(snrDb: number | null, t: PronunciationThresholds): boolean {
  return snrDb !== null && snrDb < t.minSnrDb;
}

/** The one honest line the studio shows beside every score (D-19, D-24 — calm and
 *  factual, no hedging theatre). Kept here so the copy and the thresholds it
 *  describes can never drift apart, and so a test can pin it. */
export const UNCALIBRATED_NOTICE =
  "These are Azure's scores, not a validated measurement of Italian. The good/shaky " +
  "thresholds are our own, transferred from English-language norms — no labelled " +
  "Italian pronunciation corpus exists to validate them against.";

/** The re-record line for a take too noisy to score (the SNR gate). */
export const TOO_NOISY_NOTICE =
  "That was hard to hear — too much background noise to score fairly. Try again " +
  "closer to the microphone.";
