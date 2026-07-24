import type { Migration } from "./index";

// E-31 The daily composer + day ledger (D-24). The local-day goal-completion
// ledger: one row per day the user MET their daily goal, written from day one so
// the streak E-38 renders is retroactively true. Extracted into its own module to
// keep lib/migrations/index.ts under the 500-line hook.
//
// `day_ledger` — keyed by `local_day` ("YYYY-MM-DD", the LOCAL calendar day; see
//   lib/local-day.ts for the explicit timezone stance — a streak day is a local
//   day, never a UTC day, D-24 + the E-22 UTC lesson). The row's mere EXISTENCE is
//   the fact "this day was completed"; the PRIMARY KEY makes recording idempotent
//   (INSERT OR IGNORE — a day is never double-counted however many times the goal
//   is re-observed). `completed_at` is the UTC instant the completion was first
//   recorded (audit/ordering). `cards_done`/`lessons_done` snapshot the factual
//   figures the one-per-day completion sentence states ("Done for today. 9 cards,
//   one lesson." — D-24); they are written once, at first completion, and never
//   revised, so the sentence is stable for the rest of the day.
//
// AUTHORITATIVE, not derived. Unlike `knowledge_items`' cache, this ledger cannot
// be rebuilt from other tables after the fact: "was the goal met on 3 March?"
// depends on that day's live plan and the reviews done before midnight, which no
// later snapshot preserves. So the row is the source of truth for a completed day
// and is written the moment the goal is first met (lib/day-ledger.ts). Additive
// and shipped-once, like every migration before it.
export const dayLedgerMigration: Migration = {
  version: 19,
  name: "day_completion_ledger",
  up: (db) => {
    db.exec(`
      CREATE TABLE day_ledger (
        local_day    TEXT PRIMARY KEY,
        completed_at TEXT NOT NULL DEFAULT (datetime('now')),
        cards_done   INTEGER NOT NULL DEFAULT 0,
        lessons_done INTEGER NOT NULL DEFAULT 0
      );
    `);
  },
};
