// Pure spaced-repetition scheduler (E-5 → E-25). A thin, side-effect-free wrapper
// over `ts-fsrs` (FSRS-6, MIT): it maps a review state and a grade to the next
// review state, so the whole algorithm stays unit-testable in isolation and safe
// to import from client code. lib/cards.ts is the only caller — it reads a card's
// state, runs `schedule`, and persists the result (turning `intervalDays` into a
// concrete `due` timestamp) — and its call sites are unchanged: the behaviour
// moved from SM-2 to FSRS under the same `SrsState → Grade → SrsResult` shape.
//
// SM-2 → FSRS-6 (D-19, E-25). FSRS's retrievability R(t,S) = the probability of
// recall at elapsed time t given stability S is the one strength scalar. The
// existing `cards` table carries no review log to replay, so a card is
// STATE-SEEDED, not replayed: its stored `intervalDays` seeds stability
// (S ≈ interval — the SM-2 interval approximates FSRS's 90%-retention horizon),
// its `ease` (1.3–3.0) maps linearly onto FSRS difficulty (10 → 1), and its `due`
// is kept. Each grade re-seeds FSRS from those two columns, advances it, and
// projects the result back — so the `cards` columns remain the durable state and
// no schema change is needed. The projection is lossless on difficulty (ease is a
// real column) and quantises stability to whole days (interval is an integer),
// which is the same day granularity SM-2 already used; the un-quantised FSRS
// triple lives on `knowledge_items` where per-event precision matters.
//
// Parameters are the ts-fsrs FSRS-6 DEFAULTS and are therefore UNCALIBRATED: they
// are optimised later, once real reviews accrue (E-25 logs every review as
// evidence for exactly that). FSRS self-corrects within a few reviews, so seeded
// approximations wash out — the truthful degradation path (D-13). `enable_short_term`
// is off so intervals are whole days from the first review (this drill schedules
// in days, not the sub-day learning steps Anki uses), matching the SM-2 UX.

import {
  fsrs,
  createEmptyCard,
  forgetting_curve,
  default_w,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
} from "ts-fsrs";

export type Grade = "again" | "hard" | "good" | "easy";

/** Grade → the FSRS rating it stands for (Again resets, Easy schedules furthest). */
const RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** SM-2's ease bounds, kept as the seed range mapped onto FSRS difficulty. */
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const FRESH_EASE = 2.5;

/** FSRS stability floor (days) so a zero-interval seed still yields a valid S. */
const MIN_STABILITY = 0.1;
const DAY_MS = 86_400_000;
/** A fixed reference instant. `schedule` is pure: only the *elapsed* days between
 *  the (synthetic) last review and now matter, never the absolute date. */
const EPOCH = new Date("2025-01-01T00:00:00.000Z");

/** The single FSRS engine, default FSRS-6 params (uncalibrated — see file head). */
const engine: FSRS = fsrs({ enable_short_term: false });

/** The scheduler state stored on a card (the SM-2-shaped columns). */
export interface SrsState {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

/** A freshly generated card: full ease, no reviews yet, due immediately. */
export const FRESH: SrsState = { ease: FRESH_EASE, intervalDays: 0, repetitions: 0 };

export interface SrsResult extends SrsState {
  lastGrade: Grade;
}

/** Map a stored ease (1.3–3.0) onto FSRS difficulty (10 → 1), clamped: a low-ease
 *  (hard) card is difficult, a high-ease (easy) card is not. The inverse of
 *  `difficultyToEase`, so the round trip through a grade preserves difficulty. */
export function easeToDifficulty(ease: number): number {
  const e = Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
  return 10 - ((e - MIN_EASE) / (MAX_EASE - MIN_EASE)) * 9;
}

/** Map an FSRS difficulty (1–10) back onto an ease (3.0 → 1.3), clamped. */
export function difficultyToEase(difficulty: number): number {
  const d = Math.min(10, Math.max(1, difficulty));
  return MAX_EASE - ((d - 1) / 9) * (MAX_EASE - MIN_EASE);
}

/** Seed FSRS stability from a stored interval: S ≈ interval, floored so a card
 *  that was due immediately (interval 0) still has a valid, tiny stability. */
export function seedStability(intervalDays: number): number {
  return Math.max(MIN_STABILITY, intervalDays);
}

/** Whether a state has never been reviewed (a fresh, never-graded card). */
function isNew(state: SrsState): boolean {
  return state.repetitions <= 0 && state.intervalDays <= 0;
}

/**
 * Apply a grade to a review state, returning the next state. Pure: it seeds an
 * FSRS card from the SM-2-shaped `state`, advances it one rating, and projects the
 * result back onto `{ ease, intervalDays, repetitions }`; the caller derives the
 * concrete `due` from `intervalDays` (0 = due now).
 *
 * `Again` is a lapse: the streak resets and the card is forced due the same
 * session (interval 0), exactly as the SM-2 drill behaved — FSRS's own difficulty
 * update is still kept so the algorithm learns from the miss. A passing grade
 * schedules at least one day out (the day granularity of this drill) with
 * Easy > Good > Hard from the same state.
 */
export function schedule(state: SrsState, grade: Grade): SrsResult {
  const rating = RATING[grade];
  let card: FsrsCard;
  if (isNew(state)) {
    card = createEmptyCard(EPOCH);
  } else {
    const lastReview = new Date(EPOCH.getTime() - Math.max(1, state.intervalDays) * DAY_MS);
    card = {
      due: lastReview,
      stability: seedStability(state.intervalDays),
      difficulty: easeToDifficulty(state.ease),
      elapsed_days: state.intervalDays,
      scheduled_days: state.intervalDays,
      learning_steps: 0,
      reps: state.repetitions,
      lapses: 0,
      state: State.Review,
      last_review: lastReview,
    };
  }

  const next = engine.next(card, EPOCH, rating).card;
  const ease = difficultyToEase(next.difficulty);

  if (grade === "again") {
    return { ease, intervalDays: 0, repetitions: 0, lastGrade: grade };
  }
  return {
    ease,
    intervalDays: Math.max(1, next.scheduled_days),
    repetitions: state.repetitions + 1,
    lastGrade: grade,
  };
}

/**
 * Retrievability R(t, S): the probability of recall at `elapsedDays` since the
 * last review given stability `S`, in [0, 1]. The single knowledge-strength
 * scalar (D-19), computed with the FSRS-6 forgetting curve and the default decay.
 */
export function retrievability(stability: number, elapsedDays: number): number {
  return forgetting_curve(default_w, Math.max(0, elapsedDays), Math.max(MIN_STABILITY, stability));
}
