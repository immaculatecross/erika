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

/** Repairs are NAMED while the list is this short; beyond it they are COUNTED. */
export const MAX_NAMED_REPAIRS = 2;

/**
 * The streak caption, or null when there is nothing true to say.
 *
 * DISCLOSURE IS NEVER DROPPED (review F2). The number is the run's SPAN
 * (lib/streak/compute.ts), so it includes days the learner did not practise — which
 * makes the "· repaired …" clause the only thing carrying D-19. Repairs accrue at two
 * a month with no cap on run length, so enumerating them all would eventually render
 * a 100-character itemised list of every day you missed: neither DESIGN:45's "a number
 * and a word", nor caption-length on a phone, and the closest this surface could come
 * to the guilt ledger D-24's ban list exists to prevent.
 *
 * So a long list is SUMMARISED, never truncated: "Day 162 · 12 repaired" accounts for
 * every one of them. Naming two and silently discarding ten would let the number
 * absorb ten undisclosed non-practised days, which is exactly what the span reading
 * forbids. One or two repairs are still named ("repaired Tue"), per DESIGN:45.
 */
export function streakCaption(
  streak: { currentRun: number; repairedDays: readonly StreakRepair[] },
  today: string,
): string | null {
  if (streak.currentRun <= 0) return null;
  const head = `Day ${streak.currentRun}`;
  const n = streak.repairedDays.length;
  if (n === 0) return head;
  if (n > MAX_NAMED_REPAIRS) return `${head} · ${n} repaired`;
  const labels = streak.repairedDays.map((r) => repairLabel(r.localDay, today));
  return `${head} · repaired ${labels.join(", ")}`;
}
