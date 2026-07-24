import type { Db } from "../db";
import { localDay } from "../local-day";
import { computeStreak, type StreakRepair, type StreakResult } from "./compute";

// The streak's DB glue (E-38, D-24): read `day_ledger`'s local-day keys and the
// spent-repair ledger, run the pure computation, and persist any newly charged
// repair. Server-only. No model calls, no money, and nothing here writes evidence
// or touches the day ledger — a repair records a day the goal was NOT met, which is
// precisely why it cannot live in `day_ledger` ("a row exists only when the goal
// was met" is unchanged).
//
// WHY A READ PERSISTS. The streak is derived on every read, so a repair it decides
// on must be written down or the next read could decide differently. Recording it
// is idempotent (`local_day` PRIMARY KEY + INSERT OR IGNORE), only ever concerns
// days strictly in the past, and follows the established read-path materialization
// precedent (slips materialize on read; the composer reconciles its spill queue on
// read). It is silent: nothing is shown to the learner about the write, ever.

interface RepairRow {
  local_day: string;
  charged_month: string;
}

/** Every repair credit spent so far, oldest day first. The auditable ledger. */
export function listStreakRepairs(db: Db): StreakRepair[] {
  return (
    db.prepare("SELECT local_day, charged_month FROM streak_repairs ORDER BY local_day").all() as RepairRow[]
  ).map((r) => ({ localDay: r.local_day, chargedMonth: r.charged_month }));
}

/**
 * Record newly charged repairs — IDEMPOTENT. The `local_day` PRIMARY KEY plus
 * INSERT OR IGNORE means a given missed day can consume a credit exactly once, so
 * recomputing the streak (every page load) never double-spends and never rewrites
 * an earlier charge. Returns how many rows this call actually created.
 */
export function recordStreakRepairs(db: Db, repairs: readonly StreakRepair[]): number {
  if (repairs.length === 0) return 0;
  const ins = db.prepare("INSERT OR IGNORE INTO streak_repairs (local_day, charged_month) VALUES (?, ?)");
  let created = 0;
  db.transaction(() => {
    for (const r of repairs) created += ins.run(r.localDay, r.chargedMonth).changes;
  })();
  return created;
}

/** Every local day the goal was met — the streak's source (E-31's ledger). */
export function completedDays(db: Db): string[] {
  return (db.prepare("SELECT local_day FROM day_ledger").all() as { local_day: string }[]).map(
    (r) => r.local_day,
  );
}

/** What the Learn home renders. `repairsUsedThisMonth` is carried for auditability
 *  and tests — it is NEVER rendered: a visible "1 of 2 repairs left" would be the
 *  countdown D-24 bans. */
export interface StreakView {
  currentRun: number;
  repairedDays: StreakRepair[];
  repairsUsedThisMonth: number;
  lastCompletedDay: string | null;
}

/**
 * The current streak as of `day`, with any repair it newly needed charged to the
 * ledger. Silent and automatic: the learner is never asked, and nothing is ever
 * purchasable (D-24).
 */
export function buildStreak(db: Db, day: string = localDay()): StreakView {
  const result: StreakResult = computeStreak({
    completedDays: completedDays(db),
    repairs: listStreakRepairs(db),
    today: day,
  });
  recordStreakRepairs(db, result.newRepairs);
  return {
    currentRun: result.currentRun,
    repairedDays: result.repairedDays,
    repairsUsedThisMonth: result.repairsUsedThisMonth,
    lastCompletedDay: result.lastCompletedDay,
  };
}
