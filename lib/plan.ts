import type { Db } from "./db";
import type { Category } from "./analysis/findings";
import { countDueCards } from "./cards";
import { buildFocusModel } from "./focus";
import { listIncludedFindings } from "./findings-model";
import { collectLetterSessions, latestWeekWithFindings } from "./letter";
import { derivePatterns, type Pattern } from "./lessons/patterns";
import { getLessonByPattern } from "./lessons/lessons";
import { lessonEstimateUsd } from "./lessons/estimate";

// The daily plan (E-18 criterion 1): what /practice prescribes today. Read-only
// composition over models that already exist — the due queue (E-5), the Focus
// map's severity-weighted "work on next" ranking (E-7, reused whole, never
// reimplemented), the lesson patterns (E-6) and the letter's week (E-12). No
// model calls, no gamification, no new tables.
//
// The letter-viewed marker lives in the existing `settings` key/value table
// (v1) under a key of its own — no migration. It only ever advances: opening
// this week's letter marks it read; opening an older archived week does not
// un-read the current one.

/** The one lesson the ranking prescribes, ready to state its price (criterion 5). */
export interface PlanLesson {
  key: string;
  category: Category;
  /** How many findings the pattern holds. */
  count: number;
  /** True when the lesson is generated and cached — opening it is free. */
  ready: boolean;
  /** Worst-case generation cost, stated before any call; null when `ready`. */
  estimateUsd: number | null;
}

/** The whole payload /api/plan serves and the Practice screen renders. */
export interface Plan {
  dueCount: number;
  /** The pattern Focus's ranking puts first, or null when none qualifies yet. */
  lesson: PlanLesson | null;
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

/**
 * The lesson the plan prescribes: walk Focus's severity-weighted ranking (the
 * SAME ranking the Focus screen shows — `computeFocus` via `buildFocusModel`,
 * never a second scoring) and take the first category that qualifies as a
 * pattern. A ranked category without ≥3 findings is skipped, not padded.
 */
function prescribeLesson(db: Db): PlanLesson | null {
  const patterns = new Map<Category, Pattern>(
    derivePatterns(listIncludedFindings(db)).map((p) => [p.category, p]),
  );
  for (const metric of buildFocusModel(db).ranking) {
    if (metric.count === 0) continue;
    const pattern = patterns.get(metric.category);
    if (!pattern) continue;
    const ready = getLessonByPattern(db, pattern.key) !== null;
    return {
      key: pattern.key,
      category: pattern.category,
      count: pattern.count,
      ready,
      estimateUsd: ready ? null : lessonEstimateUsd(db, pattern),
    };
  }
  return null;
}

/** Compose today's plan — one read, no writes. */
export function buildPlan(db: Db): Plan {
  const letterWeek = latestWeekWithFindings(collectLetterSessions(db));
  const viewed = getViewedLetterWeek(db);
  return {
    dueCount: countDueCards(db),
    lesson: prescribeLesson(db),
    letterWeek,
    letterUnread: letterWeek !== null && (viewed === null || viewed < letterWeek),
  };
}
