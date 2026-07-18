import type { Db } from "../db";

// Per-pattern mastery (E-6, WO criterion 5). A pattern's mastery is a 0..1 value
// updated when the learner completes its lesson. The update rule (exercised here;
// the completion trigger UI is part 2) is an exponential moving average toward the
// completion `score` (the fraction of exercises answered correctly, 0..1):
//
//     next = clamp01( prev + ALPHA * (score - prev) )
//
// with prev defaulting to 0 for a never-practised pattern. EMA is chosen over a
// last-score overwrite so mastery reflects a trend, not a single lucky run: one
// perfect completion of a fresh pattern lands mastery at ALPHA (0.5), a second at
// 0.75, asymptotically approaching a sustained score. Pure and small so the rule
// is unit-tested directly.

/** Weight of the newest completion in the moving average (0..1). */
export const MASTERY_ALPHA = 0.5;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** The next mastery value given the previous one and a completion `score` (both 0..1). */
export function nextMastery(prev: number, score: number): number {
  return clamp01(prev + MASTERY_ALPHA * (clamp01(score) - prev));
}

/** A pattern's stored mastery, or 0 if it has never been completed. */
export function getMastery(db: Db, patternKey: string): number {
  const r = db.prepare("SELECT mastery FROM lesson_mastery WHERE pattern_key = ?").get(patternKey) as
    | { mastery: number }
    | undefined;
  return r ? r.mastery : 0;
}

/**
 * Record a lesson completion for a pattern at `score` (0..1) and return the new
 * mastery. Upserts the moving-average update in one statement so concurrent
 * completions can't interleave a read and a write.
 */
export function recordCompletion(db: Db, patternKey: string, score: number): number {
  const updated = nextMastery(getMastery(db, patternKey), score);
  db.prepare(
    `INSERT INTO lesson_mastery (pattern_key, mastery, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pattern_key) DO UPDATE SET mastery = excluded.mastery, updated_at = excluded.updated_at`,
  ).run(patternKey, updated);
  return updated;
}
