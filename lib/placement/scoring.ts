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

export interface PlacementResult {
  /** Non-words marked "known" ÷ non-words presented — the response-style measure. */
  falseAlarmRate: number;
  pseudoPresented: number;
  bands: BandScore[];
  /** Highest band still reliably recognized (corrected ≥ threshold), or null when
   *  even A1 is not reliably recognized (a true beginner). */
  level: Band | null;
  /** False → the sample was too thin for a trustworthy estimate; the caller degrades
   *  truthfully ("a rough placement"). The band labels are always a frequency proxy,
   *  never a measured CEFR, regardless of this flag. */
  calibrated: boolean;
}

/** Corrected recognition at or above this counts a band as reliably recognized. */
export const RECOGNITION_THRESHOLD = 0.5;

/** Below these sample sizes the estimate is reported uncalibrated (still returned,
 *  but flagged so the UI says so — D-13). */
export const MIN_PSEUDO = 8;
export const MIN_PER_BAND = 4;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Score a completed yes/no check. `falseAlarmRate` (fa) is the share of non-words
 * the learner claimed to know; each band's corrected recognition is
 * (hitRate − fa)/(1 − fa), clamped — the guessing-corrected proportion. A learner
 * who says yes to everything has fa = 1, so every corrected value collapses to 0
 * (they read as a true beginner, not advanced — the whole point of the non-words).
 * The level is the highest band whose corrected recognition clears the threshold.
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

  // Level = the highest band that clears the threshold. Not required to be
  // contiguous — a dip at one band does not veto a clear higher band, but because
  // recognition tracks frequency this is almost always the top of a contiguous run.
  let level: Band | null = null;
  for (const b of bands) {
    if (b.presented >= 1 && b.corrected >= RECOGNITION_THRESHOLD) level = b.band;
  }

  const countedBands = bands.filter((b) => b.presented > 0);
  const calibrated =
    pseudoPresented >= MIN_PSEUDO &&
    countedBands.length > 0 &&
    countedBands.every((b) => b.presented >= MIN_PER_BAND);

  return { falseAlarmRate: fa, pseudoPresented, bands, level, calibrated };
}

/** The lemma item ids of real words the learner genuinely recognized (marked known)
 *  — exactly what placement seeds as recognition evidence (never a whole band). */
export function recognizedItemIds(answers: PlacementAnswer[]): string[] {
  return answers
    .filter((a) => a.kind === "real" && a.known && typeof a.itemId === "string")
    .map((a) => a.itemId as string);
}
