import type { Db } from "./db";
import { countDueCards } from "./cards";
import { collectLetterSessions, latestWeekWithFindings } from "./letter";

// The daily plan (E-18 criterion 1): what /practice prescribes today. Read-only
// composition over models that already exist — the due queue (E-5) and the
// letter's week (E-12). No model calls, no gamification, no new tables.
//
// [E-45] The per-CATEGORY pattern lesson is gone from here with the format it
// prescribed. It priced a lesson ("$0.004 to generate") that the learner then had
// to choose to buy, from a screen listing several kinds of lesson — the "pile of
// optional errands" D-26 exists to remove. The day's lesson is now chosen by the
// composer at the learner's knowledge edge (D-27) and is free to open, so there is
// nothing here to prescribe and nothing to price.
//
// The letter-viewed marker lives in the existing `settings` key/value table
// (v1) under a key of its own — no migration. It only ever advances: opening
// this week's letter marks it read; opening an older archived week does not
// un-read the current one.

/** The whole payload /api/plan serves and the Practice screen renders. */
export interface Plan {
  dueCount: number;
  /** The latest ISO week with a letter, "YYYY-MM-DD", or null before any findings. */
  letterWeek: string | null;
  /** True when that letter exists and has not been opened yet. */
  letterUnread: boolean;
}

const LETTER_VIEWED_KEY = "letterViewedWeek";

/** The most recent letter week the user has opened, or null. */
export function getViewedLetterWeek(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(LETTER_VIEWED_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * Record that the letter for `weekStart` has been opened. Forward-only: the
 * marker keeps the latest week ever opened ("YYYY-MM-DD" compares as a string),
 * so re-reading an older week never marks the current letter unread again.
 */
export function markLetterViewed(db: Db, weekStart: string): void {
  const current = getViewedLetterWeek(db);
  if (current !== null && current >= weekStart) return;
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(LETTER_VIEWED_KEY, weekStart);
}

/** Compose today's plan — one read, no writes. */
export function buildPlan(db: Db): Plan {
  const letterWeek = latestWeekWithFindings(collectLetterSessions(db));
  const viewed = getViewedLetterWeek(db);
  return {
    dueCount: countDueCards(db),
    letterWeek,
    letterUnread: letterWeek !== null && (viewed === null || viewed < letterWeek),
  };
}
