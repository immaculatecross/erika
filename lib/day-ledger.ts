import type { Db } from "./db";
import { countDueCards } from "./cards";
import { localDay } from "./local-day";

// The local-day goal-completion ledger (E-31, D-24). Server-only DB glue over the
// v19 `day_ledger` table: it records each local day the user met their daily goal,
// idempotently, from day one — so when E-38 renders the streak it is retroactively
// true. No model calls, no gamification here; this module only records the fact and
// answers "was this day complete?" and "how far into today's goal are we?".
//
// THE DAILY GOAL (E-31 scope). A day's goal is met when the day's actionable
// review queue is CLEARED after doing real work: the user reviewed ≥1 card today
// and no card is left due. This is the one closed loop that exists today; lessons
// (E-32) and the tutor (E-34) extend the goal later, and their counts slot into the
// same ledger row. Deliberately derived from durable card state, never a
// client-trusted counter — a refresh cannot lose or forge a completion.
//
// "Reviewed today" is recovered without a new column: a graded card's last review
// instant is `due` minus its scheduled interval (gradeCard sets
// `due = datetime('now','+interval days')`), and we reduce THAT instant to a local
// day (lib/local-day.ts) and compare. UTC timestamps stay UTC; only the day key is
// local (D-24).

const DAY_MS = 86_400_000;

/** Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:MM:SS") to epoch ms, or NaN. */
function utcMs(sqliteTs: string): number {
  return Date.parse(sqliteTs.replace(" ", "T") + "Z");
}

/**
 * How many distinct cards had their most recent review on local day `day`. A
 * card's last review = `due − interval_days`; reduced to a local day and matched.
 * A card reviewed twice in one day counts once (it is one card done).
 *
 * `advancedOnly` (the ring's "done") excludes cards that are still due right now —
 * a card re-graded `again` was reviewed today but has NOT been cleared, so counting
 * it as both done AND due would double it in the ring total. At completion (queue
 * cleared) every reviewed-today card is advanced, so the two counts agree.
 */
export function cardsReviewedToday(db: Db, day: string, advancedOnly = false): number {
  const rows = db
    .prepare("SELECT due, interval_days FROM cards WHERE last_grade IS NOT NULL")
    .all() as { due: string; interval_days: number }[];
  const nowMs = Date.now();
  let n = 0;
  for (const r of rows) {
    const dueMs = utcMs(r.due);
    if (Number.isNaN(dueMs)) continue;
    if (advancedOnly && dueMs <= nowMs) continue; // reviewed but not cleared
    const reviewMs = dueMs - r.interval_days * DAY_MS;
    if (localDay(new Date(reviewMs)) === day) n += 1;
  }
  return n;
}

/** Today's goal progress: cards done, cards still due, the ring total, and whether
 *  the goal is met (some work done AND the queue cleared). */
export interface DayGoal {
  done: number;
  dueRemaining: number;
  /** Ring denominator — the work the day set out to do (done + still due). */
  total: number;
  met: boolean;
}

export function dayGoal(db: Db, day: string): DayGoal {
  const done = cardsReviewedToday(db, day, true); // advanced (cleared) today only
  const dueRemaining = countDueCards(db);
  const total = done + dueRemaining;
  return { done, dueRemaining, total, met: total > 0 && dueRemaining === 0 };
}

/** One ledger row (a completed day). */
export interface DayCompletion {
  localDay: string;
  completedAt: string;
  cardsDone: number;
  lessonsDone: number;
}

interface DayLedgerRow {
  local_day: string;
  completed_at: string;
  cards_done: number;
  lessons_done: number;
}

function toCompletion(r: DayLedgerRow): DayCompletion {
  return {
    localDay: r.local_day,
    completedAt: r.completed_at,
    cardsDone: r.cards_done,
    lessonsDone: r.lessons_done,
  };
}

/** The completion row for `day`, or null if the day is not (yet) complete. */
export function getDayCompletion(db: Db, day: string): DayCompletion | null {
  const r = db.prepare("SELECT * FROM day_ledger WHERE local_day = ?").get(day) as
    | DayLedgerRow
    | undefined;
  return r ? toCompletion(r) : null;
}

/** Whether `day` has been recorded complete. */
export function isDayComplete(db: Db, day: string): boolean {
  return !!db.prepare("SELECT 1 FROM day_ledger WHERE local_day = ?").get(day);
}

/**
 * Record `day` complete with its factual figures — IDEMPOTENT. The `local_day`
 * PRIMARY KEY + INSERT OR IGNORE means a day is written exactly once, the first
 * time its goal is met; every later observation is a no-op, so the figures (and
 * the one-per-day completion sentence they feed) never change and no day is ever
 * double-counted. Returns true only when THIS call created the row.
 */
export function recordDayComplete(
  db: Db,
  day: string,
  figures: { cardsDone: number; lessonsDone?: number },
): boolean {
  const info = db
    .prepare(
      "INSERT OR IGNORE INTO day_ledger (local_day, cards_done, lessons_done) VALUES (?, ?, ?)",
    )
    .run(day, figures.cardsDone, figures.lessonsDone ?? 0);
  return info.changes > 0;
}

/**
 * Meet-and-record in one step, the way the completion route calls it: recompute
 * the goal server-side (authoritative — never trust the client that the ring is
 * closed) and, if it is met, record the day with its real card count. Returns the
 * completion row when the day is (now or already) complete, else null.
 */
export function completeDayIfMet(db: Db, day: string): DayCompletion | null {
  const existing = getDayCompletion(db, day);
  if (existing) return existing;
  const goal = dayGoal(db, day);
  if (!goal.met) return null;
  recordDayComplete(db, day, { cardsDone: goal.done, lessonsDone: 0 });
  return getDayCompletion(db, day);
}

/** How many days have been completed — the raw material for E-38's streak. */
export function completedDayCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM day_ledger").get() as { n: number }).n;
}
