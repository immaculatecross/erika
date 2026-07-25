import {
  isTooNoisy,
  scoreBand,
  pronunciationThresholds,
  TOO_NOISY_NOTICE,
  UNCALIBRATED_NOTICE,
  type PronunciationThresholds,
  type ScoreBand,
} from "./thresholds";
import { ticksToMs, type PronouncedPhoneme, type PronunciationResult } from "./types";

// The PURE view model behind the studio's feedback (E-37). No DB, no I/O, no React —
// so every rule about what a learner is told is unit-testable against a fixture.
//
// Three jobs:
//   1. Band each word and phoneme by its accuracy score against the TUNABLE thresholds
//      (never a magic number in a component).
//   2. Turn `nBest` alternates into the one sentence that makes phoneme feedback
//      useful in Italian — "you produced /l/ where /ʎ/ was expected" — instead of a
//      bare "wrong".
//   3. Convert the 100-ns ticks into the millisecond offsets the player seeks to, so
//      a learner can hear their own rendering of a single word.
//
// It also enforces the two honesty rules. A take below the SNR threshold yields NO
// scores at all — only a re-record prompt — because PA quality is bounded by input
// quality and a noisy take scores the room. And every scored view carries the
// uncalibrated notice: these are Azure's numbers, and the bands are our own choices
// transferred from English-language norms, because no labelled Italian pronunciation
// corpus exists to validate them against.
//
// Nothing here is prosody: it-IT returns no prosody score and no syllable groups, so
// there is no intonation or rhythm number to render (OBS-002).

export interface PhonemeCell {
  phoneme: string;
  accuracyScore: number;
  band: ScoreBand;
  startMs: number;
  durationMs: number;
  /** The phoneme the model heard instead, when the alternates make that claim
   *  clearly — else null. */
  producedInstead: string | null;
  /** The plain sentence for this phoneme, or null when there is nothing to say. */
  note: string | null;
}

export interface WordCell {
  word: string;
  accuracyScore: number;
  band: ScoreBand;
  errorType: string;
  startMs: number;
  durationMs: number;
  /** True when the word carries timing we can play back (an omitted word does not). */
  playable: boolean;
  phonemes: PhonemeCell[];
}

export interface ResultView {
  /** True when the take was too noisy to score honestly — no scores are included. */
  retake: boolean;
  /** The one calm line explaining a retake, or null. */
  retakeNotice: string | null;
  /** Null on a retake; otherwise the headline scores and the word strip. */
  scores: {
    pronScore: number;
    accuracyScore: number;
    fluencyScore: number;
    completenessScore: number;
    band: ScoreBand;
    passed: boolean;
  } | null;
  words: WordCell[];
  /** The thresholds these bands were computed with — shown so the mapping is
   *  inspectable, not hidden. */
  thresholds: PronunciationThresholds;
  /** The honesty line. Always present; never softened. */
  notice: string;
}

/**
 * The alternate the model preferred over the expected phoneme, or null. A
 * substitution is only claimed when the top alternate is a DIFFERENT phoneme AND
 * scored higher than the expected one — otherwise "you produced X instead" would be
 * an invention, and an invented diagnosis is worse than a plain low score.
 */
export function producedInstead(p: PronouncedPhoneme): string | null {
  const top = p.nBest[0];
  if (!top) return null;
  if (top.phoneme === p.phoneme) return null;
  return top.score > p.accuracyScore ? top.phoneme : null;
}

/**
 * The sentence shown for one phoneme. Specific when the alternates support it, plain
 * when they do not, silent when the phoneme was fine. Phrased as an observation about
 * what happened, with the EXPECTED sound named last so the correct target is what the
 * learner is left holding (D-18: the correction leads, the error is subordinate).
 */
export function phonemeNote(p: PronouncedPhoneme, t: PronunciationThresholds): string | null {
  if (p.accuracyScore >= t.good) return null;
  const heard = producedInstead(p);
  if (heard) return `You produced /${heard}/ where /${p.phoneme}/ was expected.`;
  return `/${p.phoneme}/ came out unclear.`;
}

function toPhonemeCell(p: PronouncedPhoneme, t: PronunciationThresholds): PhonemeCell {
  return {
    phoneme: p.phoneme,
    accuracyScore: p.accuracyScore,
    band: scoreBand(p.accuracyScore, t),
    startMs: ticksToMs(p.offsetTicks),
    durationMs: ticksToMs(p.durationTicks),
    producedInstead: producedInstead(p),
    note: phonemeNote(p, t),
  };
}

/**
 * Build the feedback view for one scored take.
 *
 * On a too-noisy take this returns `retake: true`, `scores: null` and NO word cells:
 * the scores exist (the call was billed) but presenting them would be presenting the
 * room's noise as the learner's pronunciation.
 */
export function buildResultView(
  result: PronunciationResult,
  thresholds: PronunciationThresholds = pronunciationThresholds(),
): ResultView {
  if (isTooNoisy(result.snrDb, thresholds)) {
    return {
      retake: true,
      retakeNotice: TOO_NOISY_NOTICE,
      scores: null,
      words: [],
      thresholds,
      notice: UNCALIBRATED_NOTICE,
    };
  }

  const words: WordCell[] = result.words.map((w) => ({
    word: w.word,
    accuracyScore: w.accuracyScore,
    band: scoreBand(w.accuracyScore, thresholds),
    errorType: w.errorType,
    startMs: ticksToMs(w.offsetTicks),
    durationMs: ticksToMs(w.durationTicks),
    // An omitted word has no audio of its own — Azure reports zero duration for it.
    playable: w.durationTicks > 0,
    phonemes: w.phonemes.map((p) => toPhonemeCell(p, thresholds)),
  }));

  return {
    retake: false,
    retakeNotice: null,
    scores: {
      pronScore: result.pronScore,
      accuracyScore: result.accuracyScore,
      fluencyScore: result.fluencyScore,
      completenessScore: result.completenessScore,
      band: scoreBand(result.pronScore, thresholds),
      passed: result.pronScore >= thresholds.pass,
    },
    words,
    thresholds,
    notice: UNCALIBRATED_NOTICE,
  };
}

/** Whether a scored take passes — the ONE gate that may mint evidence. A too-noisy
 *  take never passes, however high its numbers look. */
export function attemptPassed(result: PronunciationResult, t: PronunciationThresholds): boolean {
  if (isTooNoisy(result.snrDb, t)) return false;
  return result.pronScore >= t.pass;
}
