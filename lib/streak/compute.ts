import { localMonth, previousLocalDay } from "../local-day";

// The streak's whole brain (E-38, D-24) — PURE. Day keys in, a run out; no DB, no
// clock, no I/O, so every rule below is unit-testable against hand-written days
// (a clean run, one gap, two gaps, the third gap that ends it, a month rollover,
// DST boundaries, and recomputation). The DB glue lives in lib/streak/store.ts.
//
// WHAT THE STREAK IS (D-24). A run of consecutive LOCAL days on which the daily
// goal was met — `day_ledger` holds exactly those days, one row each, written the
// moment the goal was first met, so the run is retroactively true. Local days, never
// UTC (lib/local-day.ts owns that seam).
//
// THE REPAIR MECHANIC (D-24, verbatim: "two automatic silent repairs per month,
// earned not bought"):
//  · A SINGLE missed day inside an otherwise-continuous run is bridged
//    AUTOMATICALLY and SILENTLY. There is no prompt, no "use a streak freeze?"
//    modal, and nothing is ever purchasable — the credits are simply there.
//  · Two credits per CALENDAR MONTH, charged to the month of the MISSED day, so a
//    new month restores a full pair.
//  · Two missed days in a row are never bridged, however many credits are left: the
//    rule is "one missed day inside a run", not "buy your way across a gap".
//  · When the credits are gone the run simply ENDS. That is the entire consequence.
//    No warning, no countdown, no red, no guilt copy — nothing anywhere on this path
//    tells the learner what they are about to lose (D-24's ban list).
//
// TODAY IS NOT A GAP. The walk starts at today and, if today is not yet complete,
// steps straight past it without treating it as a miss: the day is not over. A
// streak that "breaks" at 00:01 would be both false and exactly the loss-aversion
// pressure D-24 forbids.
//
// WHAT THE NUMBER MEANS — THE RUN'S SPAN (operator ruling, 2026-07-24). `currentRun`
// is the INCLUSIVE SPAN of the current run: the days the learner completed PLUS the
// repaired days bridging them. A 14-day run containing one repaired day reads
// "Day 14 · repaired Tue", not "Day 13".
//
// The reasoning, recorded so the next reader does not "fix" this back to a count of
// completed days: the repair exists precisely to keep the run intact, so a repair
// that still costs the learner a number is a weaker promise than D-24 makes. The
// under-count also creates an off-by-one the learner cannot explain — they know they
// started 14 days ago and the app says 13. **The disclosure is what makes the span
// honest**: "· repaired Tue" states plainly that the run includes a bridged day, so
// nothing is hidden and D-19 is satisfied by TRANSPARENCY rather than by
// under-counting.
//
// The honesty invariant that does NOT move: a repaired day is never recorded as
// COMPLETED anywhere. `day_ledger` is untouched (a row still exists only when the
// goal was met), `repairedDays` stays a separate, disclosed list, and
// `lastCompletedDay` remains the last day actually completed. Only the displayed run
// length counts the bridge.

/** Repair credits granted per calendar month (D-24). Earned, never purchasable. */
export const REPAIRS_PER_MONTH = 2;

/** One spent repair credit: the missed local day it bridged, and the local month
 *  ("YYYY-MM") it was charged to. Persisted so it can never be spent twice. */
export interface StreakRepair {
  localDay: string;
  chargedMonth: string;
}

export interface StreakInput {
  /** Every local day the goal was met ("YYYY-MM-DD"), any order, duplicates fine. */
  completedDays: readonly string[];
  /** Repairs already charged (the persisted ledger). Empty on a first computation. */
  repairs?: readonly StreakRepair[];
  /** The local day the run is measured as of — "today". */
  today: string;
}

export interface StreakResult {
  /** The current run's inclusive SPAN in local days: days completed PLUS the
   *  repaired days bridging them. The repairs are disclosed in `repairedDays` and
   *  in the caption, which is what keeps the span honest (see the note above). */
  currentRun: number;
  /** The repairs the current run is standing on, most recent first — the disclosure
   *  the span depends on. A repaired day is bridged, never recorded as completed. */
  repairedDays: StreakRepair[];
  /** Repair credits already charged to `today`'s calendar month (0..2). */
  repairsUsedThisMonth: number;
  /** Repairs this computation newly charged — what the store must persist. Empty on
   *  a recomputation over the same days, which is what makes it non-double-spending. */
  newRepairs: StreakRepair[];
  /** The most recent completed day in the run, or null when there is no run. */
  lastCompletedDay: string | null;
}

/**
 * Compute the current run and the repairs holding it together.
 *
 * IDEMPOTENT BY CONSTRUCTION. Credits are counted from the WHOLE persisted repair
 * ledger (every row for a month, whether or not the day it bridged is still inside
 * the current run) — a spent credit stays spent, so history is never quietly
 * rewritten and re-running this over the same input charges nothing new
 * (`newRepairs` comes back empty). The store's `local_day` PRIMARY KEY is the
 * second, independent guard.
 */
export function computeStreak(input: StreakInput): StreakResult {
  const complete = new Set(input.completedDays);
  const ledger = input.repairs ?? [];
  const repairByDay = new Map(ledger.map((r) => [r.localDay, r]));

  // Credits already spent, per month, from the persisted ledger. A repair whose day
  // has since fallen out of the current run STILL counts: it was spent.
  const spent = new Map<string, number>();
  for (const r of ledger) spent.set(r.chargedMonth, (spent.get(r.chargedMonth) ?? 0) + 1);

  // `completed` is tracked apart from the span so the "a repaired day is never
  // credited as completed" invariant stays legible: the span is the sum of the two.
  let completed = 0;
  let lastCompletedDay: string | null = null;
  const repairedDays: StreakRepair[] = [];
  const newRepairs: StreakRepair[] = [];

  // Today counts when it is complete; when it is not, it is skipped rather than
  // treated as a miss — the day is still in progress (see the note above).
  let cursor = input.today;
  if (complete.has(cursor)) {
    completed += 1;
    lastCompletedDay = cursor;
  }
  cursor = previousLocalDay(cursor);

  for (;;) {
    if (complete.has(cursor)) {
      completed += 1;
      if (lastCompletedDay === null) lastCompletedDay = cursor;
      cursor = previousLocalDay(cursor);
      continue;
    }

    // `cursor` is a missed day. It is bridgeable only if it is a SINGLE miss inside
    // a run — the day before it must itself be complete. Two in a row ends the run.
    const before = previousLocalDay(cursor);
    if (!complete.has(before)) break;

    const already = repairByDay.get(cursor);
    if (already) {
      // Already paid for on an earlier computation — reuse it, charge nothing.
      repairedDays.push(already);
      cursor = before;
      continue;
    }

    const month = localMonth(cursor);
    if ((spent.get(month) ?? 0) >= REPAIRS_PER_MONTH) break; // credits gone → the run ends, quietly

    const repair: StreakRepair = { localDay: cursor, chargedMonth: month };
    spent.set(month, (spent.get(month) ?? 0) + 1);
    repairedDays.push(repair);
    newRepairs.push(repair);
    cursor = before;
  }

  // A run with no COMPLETED day stands on nothing — never report repairs for it.
  if (completed === 0) {
    repairedDays.length = 0;
    newRepairs.length = 0;
  }

  // The span: completed days plus the repaired days bridging them. Every repaired
  // day here lies strictly inside the run (a repair requires the day before it to be
  // complete), so the sum is exactly the run's inclusive length in local days.
  const currentRun = completed === 0 ? 0 : completed + repairedDays.length;

  const thisMonth = localMonth(input.today);
  const persistedThisMonth = ledger.filter((r) => r.chargedMonth === thisMonth).length;
  const freshThisMonth = newRepairs.filter((r) => r.chargedMonth === thisMonth).length;

  return {
    currentRun,
    repairedDays,
    repairsUsedThisMonth: persistedThisMonth + freshThisMonth,
    newRepairs,
    lastCompletedDay,
  };
}
