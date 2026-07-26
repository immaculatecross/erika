import type { Migration } from "./index";

// E-44 · v30 — the durable record of ONE DAY'S SESSION.
//
// Learn stops being a list of errands: a day is one linear session, and the day is
// complete when the session is (D-26). That needs two durable facts nothing else in
// the schema could answer:
//
//   1. WHERE THE LEARNER LEFT OFF, so closing the tab and returning resumes at the
//      step they were on rather than at the top.
//   2. WHAT TODAY'S SESSION IS, decided ONCE when the session opens and never
//      recomputed.
//
// (2) is the load-bearing one and it is easy to miss. Every input the planner reads
// MOVES WHILE THE LEARNER WORKS: answering an exercise writes evidence, which changes
// an item's status, which changes what the composer would pick; grading a card empties
// the due queue; an ingest finishing mints new cards. A session recomputed on every
// read would therefore shift under the learner's feet — the step list would grow or
// shrink mid-session, the ring's denominator would move, and the home's "what today
// holds" sentence would have been a lie by the time they finished. Freezing the plan
// at open is what makes the day a promise instead of a running total.
//
//   local_day      the LOCAL calendar day (D-24/E-31 — a streak day is a local day,
//                  never a UTC one), and the PK: one session per day, so opening the
//                  session twice is idempotent and can never fork the day.
//   started_at     when the learner pressed Start. Server clock, SQLite UTC text.
//   ended_at       when the last step completed, else NULL. A session left unfinished
//                  is simply an unfinished day — nothing is inferred from NULL.
//   steps          JSON array of the ordered step keys, FROZEN AT OPEN.
//   done_steps     JSON array of the step keys completed so far. A SET, not a
//                  counter: re-posting a step is a no-op, so nothing can be inflated
//                  by a retry, a double-tap or a refresh.
//   lesson_item_id the knowledge item the lesson step teaches, frozen at open for the
//                  same reason — today's lesson is not allowed to become a different
//                  lesson halfway through.
//   planned_cards  how many cards the drills step set out to do, frozen at open. It is
//                  the drills step's completion bar (`cardsReviewedToday >= this`),
//                  which is why it must not float: cards minted by an ingest that
//                  finishes mid-session must not un-complete a step the learner
//                  already finished.
//
// Additive; no shipped migration is edited. Nothing here is money, evidence or a
// finding — it is the learner's own day, and it is rebuilt from scratch every day.
export const dailySessionsMigration: Migration = {
  version: 30,
  name: "daily_sessions",
  up: (db) => {
    db.exec(`
      CREATE TABLE daily_sessions (
        local_day      TEXT PRIMARY KEY,
        started_at     TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at       TEXT,
        steps          TEXT NOT NULL,
        done_steps     TEXT NOT NULL DEFAULT '[]',
        lesson_item_id TEXT,
        planned_cards  INTEGER NOT NULL DEFAULT 0
      );
    `);
  },
};
