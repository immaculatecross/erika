import type { Db } from "../db";

// "Has this database ever met anybody?" (E-46 criterion 1). Server-only — it reads
// the database — and deliberately generous, because the two directions of this
// question have wildly asymmetric costs.
//
// Getting it WRONG-TOO-EAGER means a new learner slips past the check and gets the
// generic A1 day one that Amendment 1 exists to kill. Annoying, recoverable.
//
// Getting it WRONG-TOO-STRICT means a learner with a year of recordings is bounced
// into a vocabulary check on every click and cannot reach their own data. That is a
// LOCKOUT, and it is worse. So `onboardingComplete` is a disjunction: ANY sign of a
// real learner is enough, and only a database with no sign at all is gated.
//
// The four signs, and why each is here:
//
//  1. The explicit marker (`onboarding_completed_at` in `settings`). Written when a
//     learner walks out of the flow, whatever the check concluded. This is the one
//     that must exist, because a placement can legitimately write NOTHING: a run
//     refused as unmeasurable (`invalidatesMeasurement`, REVIEW-63 F1) records no run
//     and seeds no evidence by design, and a learner below A1 who recognized no words
//     seeds no evidence either. Keying the gate on the placement's writes alone would
//     hold exactly those two learners hostage forever — the trap this milestone is
//     most at risk of shipping. It goes in `settings` (key/value since v1) rather than
//     a new table, so this milestone carries no migration; `readSettings` selects only
//     the keys it knows, so an unknown key is inert.
//  2. A recorded placement run (`placement_runs`, v27). Belt and braces for a learner
//     placed by this build whose marker write lost a race.
//  3. Any placement evidence. A database placed BEFORE this milestone (or before v27)
//     has recognition rows and no marker. Those learners must not meet a gate that did
//     not exist when they started.
//  4. Any recording, completed day, or daily session. Someone who has recorded, or
//     met a daily goal, or opened a session is unmistakably a learner of this app.
//     On a genuinely empty database all three tables are empty, so these clauses can
//     never weaken the force; they only ever rescue somebody who was already here.
//     [REVIEW-85] `day_ledger` and `daily_sessions` were missing, which stranded a
//     real person: the pre-E-46 LEARN-ONLY learner, who has completed days and a
//     daily session but has never recorded and dismissed the old placement prompt.
//     They would have met the gate on every route. Recoverable — the check re-places
//     them — but it is exactly the trap class this disjunction is wide to avoid, and
//     "recoverable" is not the standard being aimed at.

/** The `settings` key holding the ISO instant the learner finished onboarding. */
export const ONBOARDING_MARKER_KEY = "onboarding_completed_at";

function tableHasRow(db: Db, sql: string): boolean {
  try {
    return !!db.prepare(sql).get();
  } catch {
    // A table a migration has not created yet is "no evidence", never a crash on
    // the one code path every page render passes through.
    return false;
  }
}

/** The explicit "the learner walked out of onboarding" marker, or null. */
export function onboardingMarker(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(ONBOARDING_MARKER_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Has this database met a learner? See the header for why this is a disjunction and
 * why erring generous is the correct direction.
 */
export function onboardingComplete(db: Db): boolean {
  if (onboardingMarker(db) !== null) return true;
  if (tableHasRow(db, "SELECT 1 FROM placement_runs LIMIT 1")) return true;
  if (tableHasRow(db, "SELECT 1 FROM evidence WHERE source = 'placement' LIMIT 1")) return true;
  if (tableHasRow(db, "SELECT 1 FROM sessions LIMIT 1")) return true;
  if (tableHasRow(db, "SELECT 1 FROM day_ledger LIMIT 1")) return true;
  if (tableHasRow(db, "SELECT 1 FROM daily_sessions LIMIT 1")) return true;
  return false;
}

/**
 * Record that the learner finished onboarding. Idempotent — the FIRST completion
 * instant is kept, because this is a fact about when they arrived, not about the
 * last time they visited the screen.
 */
export function markOnboardingComplete(db: Db, at: Date = new Date()): string {
  const existing = onboardingMarker(db);
  if (existing !== null) return existing;
  const iso = at.toISOString();
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(
    ONBOARDING_MARKER_KEY,
    iso,
  );
  return onboardingMarker(db) ?? iso;
}
