// The placement vocabulary check's scoring (E-35, D-13). A PURE function — no I/O,
// no model call — over the learner's yes/no answers. It corrects the raw
// recognition rate for response style using the pseudoword false-alarm rate (the
// standard yes/no vocabulary-test correction), then derives a coarse level: the
// highest frequency band the learner still reliably recognizes.
//
// Client-safe: pure data in, plain object out. Unit-tested against fixtures — a
// pure-guesser (says yes to everything, including non-words) must NOT read as
// advanced, a realistic responder must recover the band they actually know, and
// the false-alarm correction must measurably move the estimate.

/** The coarse frequency bands (A1…C2), least → most advanced. These are a
 *  FREQUENCY proxy, not a measured CEFR level — the same license-clean banding the
 *  lexicon uses (`rankToBand`); the placement level inherits that honesty. */
export const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Band = (typeof BANDS)[number];

export function bandIndex(b: Band): number {
  return BANDS.indexOf(b);
}

/** One item's yes/no answer. Real words carry the band they were sampled from and
 *  the lemma knowledge-item id (for seeding); pseudowords carry neither. */
export interface PlacementAnswer {
  kind: "real" | "pseudo";
  /** The lemma item id — real words only (`lemma:<lemma>#<POS>`). */
  itemId?: string;
  /** The frequency band the real word was sampled from. */
  band?: Band;
  /** The learner marked "I know this word". */
  known: boolean;
}

/** Per-band recognition, corrected for yes-bias. */
export interface BandScore {
  band: Band;
  presented: number;
  /** Real words in this band the learner marked known. */
  hits: number;
  /** hits / presented, uncorrected. */
  hitRate: number;
  /** (hitRate − fa) / (1 − fa), clamped to [0,1] — the yes-bias-corrected estimate. */
  corrected: number;
}

/**
 * Why an estimate is not trustworthy, or null when it is. `calibrated` is exactly
 * `caveat === null`, so the UI's rough-placement line is driven by real confidence and
 * not by sample size alone (RETRO-004 §DE-2 — see `scorePlacement`).
 */
export type PlacementCaveat =
  /** Too many non-words claimed as known: the answers do not separate known from unknown. */
  | "response-style"
  /** A band above the claimed level cleared while a band below it failed — noise, not a level. */
  | "inconsistent"
  /** Too few items to estimate from — too few non-words, or a frequency band that was
   *  never measured to `MIN_PER_BAND` (REVIEW-63 N1). */
  | "thin-sample";

export interface PlacementResult {
  /** Non-words marked "known" ÷ non-words presented — the response-style measure. */
  falseAlarmRate: number;
  pseudoPresented: number;
  bands: BandScore[];
  /** The level claimed: the top of the CONTIGUOUS run of cleared bands starting at A1,
   *  or null when A1 itself is not reliably recognized, when a band below the run was
   *  not measured to `MIN_PER_BAND` (REVIEW-63 N1), or when the response-style control
   *  failed (REVIEW-63 F1). Never a high band floating above failed, or unmeasured,
   *  lower ones (§DE-2). */
  level: Band | null;
  /** The highest band clearing the threshold whether or not the run below it holds —
   *  DIAGNOSTIC ONLY. Kept because the gap between this and `level` is precisely what
   *  the old scorer mistook for a level. */
  highestCleared: Band | null;
  /** True when the MEASURED contiguous run reaches `highestCleared` — no cleared band
   *  floating above a failed or unmeasured one. A band-coherence diagnostic only: it is
   *  computed before the response-style refusal, so a `response-style` run can report
   *  `contiguous: true` alongside `level: null`. */
  contiguous: boolean;
  /** Why the estimate is rough, or null when it is trustworthy. */
  caveat: PlacementCaveat | null;
  /** False → the caller MUST degrade truthfully ("a rough placement" plus the reason).
   *  Equal to `caveat === null`. The band labels are always a frequency proxy, never a
   *  measured CEFR, regardless of this flag. */
  calibrated: boolean;
}

/** Corrected recognition at or above this counts a band as reliably recognized. */
export const RECOGNITION_THRESHOLD = 0.5;

/** Below these sample sizes the check has not measured enough to place anyone.
 *
 *  [REVIEW-63 N1] `MIN_PER_BAND` used to affect only the `calibrated` flag, and a band
 *  with `presented === 0` was skipped by the level walk as if it were transparent. So a
 *  crafted 16-answer POST (8 C2 words known, 8 pseudowords rejected) returned
 *  `level: "C2", calibrated: true, caveat: null` and seeded 238 rules with ZERO evidence
 *  about A1–C1. Every band must now reach `MIN_PER_BAND` before any level may be claimed:
 *  an unmeasured band BREAKS the run rather than being walked through. Not reachable from
 *  the shipped UI (`buildPlacementCheck` always emits 8×6 real + 16 pseudo), but the route
 *  accepts arbitrary answers and "not reachable today" is how the §DE-2 defects were
 *  justified. */
export const MIN_PSEUDO = 8;
export const MIN_PER_BAND = 4;

/**
 * Above this false-alarm rate the answers are not a measurement.
 *
 * [RETRO-004 §DE-2] `calibrated` used to check sample sizes ONLY, so the reviewer's
 * measured fa of 0.5625 — better than half the invented words claimed as known —
 * returned `calibrated: true` and the UI showed a bare "Placed around C2." with no
 * caveat. The most wrong placements were shown the most confidently. A learner
 * discriminating properly sits near 0; 0.25 (4 of 16 non-words) is already careless,
 * and at or past it the yes-bias correction is extrapolating from a response style rather
 * than measuring vocabulary. The correction still applies below the threshold.
 *
 * [REVIEW-63 N2] The comparison is INCLUSIVE (`fa >= MAX_FALSE_ALARM_RATE`). It used to be
 * exclusive, so exactly 4 of 16 non-words claimed known — the value this comment calls
 * "already careless" — read as `calibrated: true` with no caveat and seeded 238 rules. The
 * code and its own prose now agree, and they agree in the safe direction: refuse rather
 * than over-claim.
 *
 * [REVIEW-63 F1] Reaching this threshold no longer only softens the PRESENTATION. It
 * refuses the level outright (`level: null`) and, at the seam, refuses to write anything
 * at all — see `seedPlacement`.
 */
export const MAX_FALSE_ALARM_RATE = 0.25;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Score a completed yes/no check. `falseAlarmRate` (fa) is the share of non-words
 * the learner claimed to know; each band's corrected recognition is
 * (hitRate − fa)/(1 − fa), clamped — the guessing-corrected proportion. A learner
 * who says yes to everything has fa = 1, so every corrected value collapses to 0
 * (they read as a true beginner, not advanced — the whole point of the non-words).
 *
 * The level is the top of the CONTIGUOUS run of MEASURED, cleared bands starting at A1,
 * and the result carries a `caveat` whenever it must not be presented as confident. When
 * the non-word control itself fails (`fa >= MAX_FALSE_ALARM_RATE`) no level is returned at
 * all: there is nothing to hedge, only answers (REVIEW-63 F1).
 */
export function scorePlacement(answers: PlacementAnswer[]): PlacementResult {
  const pseudo = answers.filter((a) => a.kind === "pseudo");
  const pseudoPresented = pseudo.length;
  const falseAlarms = pseudo.filter((a) => a.known).length;
  const fa = pseudoPresented > 0 ? falseAlarms / pseudoPresented : 0;

  const bands: BandScore[] = BANDS.map((band) => {
    const inBand = answers.filter((a) => a.kind === "real" && a.band === band);
    const presented = inBand.length;
    const hits = inBand.filter((a) => a.known).length;
    const hitRate = presented > 0 ? hits / presented : 0;
    // fa ≥ 1 means every non-word was accepted: no signal survives the correction.
    const corrected = presented === 0 || fa >= 1 ? 0 : clamp01((hitRate - fa) / (1 - fa));
    return { band, presented, hits, hitRate, corrected };
  });

  const clears = (b: BandScore) => b.presented >= 1 && b.corrected >= RECOGNITION_THRESHOLD;

  // [RETRO-004 §DE-2] Level = the top of the CONTIGUOUS run of cleared bands, walking
  // up from A1. It used to be "the highest band that clears, not required to be
  // contiguous", justified by the claim that recognition tracks frequency so this is
  // almost always the top of a contiguous run. Over 8 words per band that claim is
  // false often enough to be dangerous: the reviewer's careless run FAILED A1 (0.43),
  // FAILED A2 (0.14) and FAILED C1 (0.43) yet was placed at C2 because C2 alone came
  // up 1.00 — one band of sampling noise deciding everything, and the scorer never
  // noticed it was placing a learner who cannot recognize the thousand commonest words
  // at the top of the scale. Requiring the run to hold from A1 means a false pass now
  // needs EVERY lower band to pass too, which noise does not do.
  //
  // [REVIEW-63 N1] An UNMEASURED band now breaks the run too. It used to be skipped
  // (`if (b.presented === 0) continue`), on the reasoning that a band nobody sampled
  // should not count against the learner — but "does not count against" quietly became
  // "is treated as cleared", and a hand-built 16-answer POST reached a confident C2 with
  // no evidence at all about A1–C1. A band below the claimed level must be MEASURED and
  // cleared, not merely not-failed, so `presented` short of `MIN_PER_BAND` stops the walk.
  let measuredLevel: Band | null = null;
  for (const b of bands) {
    if (b.presented < MIN_PER_BAND) break;
    if (!clears(b)) break;
    measuredLevel = b.band;
  }

  // Diagnostic: the old, credulous answer. Where it exceeds the measured run, a cleared
  // band is floating above a failed or unmeasured one — incoherent, reported as such.
  let highestCleared: Band | null = null;
  for (const b of bands) if (clears(b)) highestCleared = b.band;
  const contiguous = measuredLevel === highestCleared;

  // [REVIEW-63 N1] Every band on the scale, not just the ones that happened to be
  // sampled: `countedBands.every(...)` was vacuously true for a submission that skipped
  // five of the six bands.
  const sampleOk = pseudoPresented >= MIN_PSEUDO && bands.every((b) => b.presented >= MIN_PER_BAND);

  // Ordered by how much each undermines the estimate. Response style comes first: if
  // the non-word control failed there is no measurement to caveat, only answers.
  //
  // [REVIEW-63 N1] `thin-sample` now precedes `inconsistent`. When part of the scale was
  // never measured the run is not contiguous either, and "recognition was uneven" would be
  // a false explanation — the more common words were not asked, not refused. What is
  // missing is the measurement, so that is what gets reported.
  const caveat: PlacementCaveat | null =
    fa >= MAX_FALSE_ALARM_RATE ? "response-style" : !sampleOk ? "thin-sample" : !contiguous ? "inconsistent" : null;

  // [REVIEW-63 F1] The response-style control failing refuses the LEVEL, not just its
  // confidence. The scorer's own principle (above): if the non-word control failed there
  // is no measurement to caveat, only answers — so "Placed around A2, roughly" was still
  // one claim too many. Measured before this fix: a 3-of-4 careless run (fa 0.625)
  // returned `level: "A2"` and seeded 65 rules + 38 words under a "rough placement" line.
  // `contiguous`/`highestCleared` keep reporting what the bands did, for diagnosis.
  const level = caveat === "response-style" ? null : measuredLevel;

  return {
    falseAlarmRate: fa,
    pseudoPresented,
    bands,
    level,
    highestCleared,
    contiguous,
    caveat,
    calibrated: caveat === null,
  };
}

/** The lemma item ids of real words the learner genuinely recognized (marked known)
 *  — exactly what placement seeds as recognition evidence (never a whole band). */
export function recognizedItemIds(answers: PlacementAnswer[]): string[] {
  return answers
    .filter((a) => a.kind === "real" && a.known && typeof a.itemId === "string")
    .map((a) => a.itemId as string);
}
