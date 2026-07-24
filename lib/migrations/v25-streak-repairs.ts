import type { Migration } from "./index";

// E-38 Streak & map (D-24, the calm habit layer). The streak itself is DERIVED —
// it is recomputed from `day_ledger`'s local-day keys on every read and stores
// nothing. The one thing that cannot be derived is which repair credits have been
// SPENT, so that is what this table holds.
//
// THE MECHANIC (D-24, verbatim): two automatic silent repairs per calendar month,
// earned not bought. A single missed day inside an otherwise-continuous run is
// bridged automatically — no prompt, no modal, no purchase — consuming one of that
// month's two credits. When a month's credits are gone the run simply ends. There
// is no warning, no countdown and no guilt copy anywhere on this path.
//
//  streak_repairs — one row per LOCAL DAY that a repair credit was spent on.
//    `local_day` is the PRIMARY KEY, which is the whole idempotency story: the
//    streak recomputes on every read and re-offers the same repair for the same
//    missed day, and `INSERT OR IGNORE` makes that a no-op. A credit is therefore
//    charged exactly once per missed day, and recomputation can never double-spend
//    or silently rewrite history. `charged_month` ("YYYY-MM", the LOCAL month of
//    the missed day) is stored rather than derived so the ledger stays auditable
//    even if the fairness rule ever changes: what the month was charged is a
//    recorded fact, not a re-derivation. `created_at` is the usual UTC instant
//    (D-24's local-vs-UTC stance: timestamps stay UTC, only day/month KEYS are
//    local — lib/local-day.ts).
//
//    Deliberately FK-free: a repair is a fact about a day the user did NOT complete,
//    so there is no `day_ledger` row to reference (the ledger only holds days the
//    goal was MET). The `spend_ledger`/`phrase_renders` precedent.
//
// PARALLEL BATCH: E-37 (the pronunciation studio) owns migration v24 and is in
// flight; this migration is v25 as assigned up front, the v18-syllabus precedent
// (lib/migrations/v18-syllabus.ts:20-23). The trivial docs/schema.md + index.ts
// append-conflict is reconciled when whichever PR rebases second lands. Additive;
// no shipped migration is edited; no money path is touched.
export const streakRepairsMigration: Migration = {
  version: 25,
  name: "streak_repairs",
  up: (db) => {
    db.exec(`
      CREATE TABLE streak_repairs (
        local_day     TEXT PRIMARY KEY,
        charged_month TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_streak_repairs_month ON streak_repairs(charged_month);
    `);
  },
};
