import type { Db } from "./db";
import { localDay } from "./local-day";

// The local-day goal-completion ledger (E-31, D-24). Server-only DB glue over the
// v19 `day_ledger` table: it records each local day the user met their daily goal,
// idempotently, from day one — so when E-38 renders the streak it is retroactively
// true. No model calls, no gamification here; this module only records the fact and
// answers "was this day complete?".
//
// WHAT DECIDES THE GOAL LIVES ELSEWHERE NOW (E-44). Until E-44 this module also
// computed the goal, and it counted flashcards alone — so a lesson and a whole
// conversation contributed nothing to the day. `lib/session/day.ts` owns that
// question now ("the day is complete when the session is", D-26); this file is the
// ledger and nothing else, which is why it no longer imports the card model. Rows
// already written are never revisited: they record what was true on the day they were
// written, under the rule in force then.
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

/** How many days have been completed — the raw material for E-38's streak. */
export function completedDayCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM day_ledger").get() as { n: number }).n;
}
