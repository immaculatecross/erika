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
// WHAT THE NUMBER MEANS (D-19 honesty). `currentRun` counts only days the learner
// ACTUALLY completed. A repaired day is bridged, not credited: Erika never says you
// practised on a day you did not. The repairs are reported alongside, factually
// ("repaired Tue"), which is what explains why the number did not reset.

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
  /** Consecutive days COMPLETED in the current run (repaired days not counted). */
  currentRun: number;
  /** The repairs the current run is standing on, most recent first. */
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

  let currentRun = 0;
  let lastCompletedDay: string | null = null;
  const repairedDays: StreakRepair[] = [];
  const newRepairs: StreakRepair[] = [];

  // Today counts when it is complete; when it is not, it is skipped rather than
  // treated as a miss — the day is still in progress (see the note above).
  let cursor = input.today;
  if (complete.has(cursor)) {
    currentRun += 1;
    lastCompletedDay = cursor;
  }
  cursor = previousLocalDay(cursor);

  for (;;) {
    if (complete.has(cursor)) {
      currentRun += 1;
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

  // A run of zero completed days stands on nothing — never report repairs for it.
  if (currentRun === 0) {
    repairedDays.length = 0;
    newRepairs.length = 0;
  }

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
