// Pure SM-2 spaced-repetition scheduler (E-5). No DB, no Date, no I/O — it maps a
// review state and a grade to the next review state, so the whole algorithm is
// unit-testable in isolation and safe to import from client code. lib/cards.ts is
// the only caller: it reads a card's state, runs `schedule`, and persists the
// result (turning `intervalDays` into a concrete `due` timestamp).
//
// The four buttons map to SuperMemo qualities: Again/Hard are the failing/low
// grades, Good/Easy the passing ones. On a lapse (Again) the streak resets and
// the card falls due immediately (interval 0) so it comes back the same day; on a
// pass the interval grows 1 → 6 → round(prev × ease) days. The ease factor is
// updated *before* the interval so a higher grade both raises ease and lengthens
// the interval most — Easy > Good > Hard from the same state. Ease is floored at
// 1.3 (SM-2's bound) so a run of hard grades can never drive it to zero.

export type Grade = "again" | "hard" | "good" | "easy";

/** SM-2 recall qualities (0–5). Below 3 is a lapse that resets the streak. */
const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

export const MIN_EASE = 1.3;
export const FRESH_EASE = 2.5;

/** The scheduler state stored on a card (the SM-2 columns). */
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

/** SM-2 ease delta for a quality q: −0.32 (again) · −0.14 (hard) · 0 (good) · +0.10 (easy). */
function easeDelta(q: number): number {
  return 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
}

/**
 * Apply a grade to a review state, returning the next state. Pure: the caller
 * derives the concrete `due` date from `intervalDays` (0 = due now).
 */
export function schedule(state: SrsState, grade: Grade): SrsResult {
  const q = QUALITY[grade];
  const ease = Math.max(MIN_EASE, state.ease + easeDelta(q));

  // Lapse: reset the streak and make the card due again immediately.
  if (q < 3) {
    return { ease, intervalDays: 0, repetitions: 0, lastGrade: grade };
  }

  const repetitions = state.repetitions + 1;
  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  // +1 guard guarantees strictly monotonic growth even when rounding would stall.
  else intervalDays = Math.max(state.intervalDays + 1, Math.round(state.intervalDays * ease));

  return { ease, intervalDays, repetitions, lastGrade: grade };
}
