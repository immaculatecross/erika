import type { Migration } from "./index";

// RETRO-004 §DE-2: make a placement RE-placeable. A careless run seeded 238 grammar
// rules as `introduced`, the daily plan started serving C2 grammar, and re-taking the
// check honestly as an A1 beginner returned `level: "A1"` while `/api/learn/items` went
// on serving the same C2 rules. `evidence` is append-only (the v14 triggers reject
// UPDATE and DELETE, correctly — it is the source of truth), `alreadyPlacementSeeded`
// skipped anything already seeded, and no retraction path existed anywhere. Only
// deleting the database recovered. That is the definition of unrecoverable.
//
// `placement_runs` — one row per completed placement, and the mechanism of supersession.
//   Seeded evidence now carries `source_ref = 'placement:<run id>'`, and the evidence
//   READ path (lib/knowledge/derive.ts `itemEvidence`) shows placement rows only from
//   the LATEST run. So a later placement supersedes an earlier one without a single row
//   being rewritten or removed: the log keeps every observation ever made (a re-placed
//   learner's history is still auditable), and the derivation simply stops treating a
//   retracted run's guesses as current belief. Append-only is preserved exactly.
//
//   * `seq` — AUTOINCREMENT, and the ONLY ordering used. `created_at` is second-
//     granular, so two placements inside one second tie and "latest" becomes arbitrary
//     — which for a supersession rule is a correctness bug, not a cosmetic one. `seq`
//     is monotonic by construction.
//   * `id` — the opaque run id that appears in `evidence.source_ref`. UNIQUE; TEXT, and
//     deliberately not a foreign key from `evidence`: evidence outlives what it cites
//     (the `source_ref`/`spend_ledger` precedent), and the append-only log must never
//     be constrained by a table that could be pruned.
//   * `level` / `calibrated` / `false_alarm_rate` — what this run actually concluded,
//     recorded so the seeding is auditable after the fact. `level` is nullable: a run
//     that could not place the learner is still a run, and still supersedes.
//
// Additive: nothing existing is touched, no shipped migration is edited, the v14
// triggers stand, and recognition still never mints `known` (D-19).
export const placementRunsMigration: Migration = {
  version: 27,
  name: "placement_runs",
  up: (db) => {
    db.exec(`
      CREATE TABLE placement_runs (
        seq              INTEGER PRIMARY KEY AUTOINCREMENT,
        id               TEXT NOT NULL UNIQUE,
        level            TEXT,
        calibrated       INTEGER NOT NULL DEFAULT 0,
        false_alarm_rate REAL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
