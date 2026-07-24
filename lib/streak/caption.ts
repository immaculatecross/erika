import { localWeekday, previousLocalDay } from "../local-day";
import type { StreakRepair } from "./compute";

// The streak's one line of copy (E-38), CLIENT-SAFE and pure so it is render-tested
// rather than eyeballed. DESIGN.md:42-49 is binding and this is the whole surface:
//
//   "Day 14"                — a number and a word, caption style. Nothing else.
//   "Day 14 · repaired Tue" — repairs acknowledged factually, never apologetically.
//
// What is NOT here, deliberately (D-24's ban list, enforced by review): no flame, no
// badge, no points, no "don't break the chain", no countdown of remaining repairs, no
// warning that a streak is at risk, and no copy at all on a day with no run — a zero
// run renders NOTHING rather than a nag or a "start your streak!" prompt. Green is
// never spent here either: a streak is attendance, and green means mastery (D-24).

/** Repaired days within a week read as a weekday ("Tue"); older ones as a date
 *  ("14 Jul"), because "Tue" stops being a useful pointer past seven days. */
export function repairLabel(day: string, today: string): string {
  let cursor = today;
  for (let i = 0; i < 7; i++) {
    if (cursor === day) return localWeekday(day);
    cursor = previousLocalDay(cursor);
  }
  const [, m, d] = day.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1] ?? m}`;
}

/**
 * The streak caption, or null when there is nothing true to say. Repairs are listed
 * in full (most recent first) so the line never claims more continuity than the
 * ledger can account for.
 */
export function streakCaption(
  streak: { currentRun: number; repairedDays: readonly StreakRepair[] },
  today: string,
): string | null {
  if (streak.currentRun <= 0) return null;
  const head = `Day ${streak.currentRun}`;
  if (streak.repairedDays.length === 0) return head;
  const labels = streak.repairedDays.map((r) => repairLabel(r.localDay, today));
  return `${head} · repaired ${labels.join(", ")}`;
}
