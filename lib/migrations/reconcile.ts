import type { Database } from "better-sqlite3";

// Ledger reconciliation — the repair step that runs BEFORE the migration loop.
//
// WHY THIS EXISTS (RETRO-004 technical lens §C1). The E-37 pronunciation migration
// really did ship as **v24 on the `feat/pronunciation-studio` branch** — commit
// 5c32ac6 created `pronunciation_attempts` + 2 indexes under `version: 24`, and
// commit 2bcc810 grew it to also create `pronunciation_visits` + its index, still
// under `version: 24`. Anyone who ran the app from that branch (the operator and any
// dev machine, which on a solo-operator repo is the normal workflow) has a database
// carrying the `_migrations` row `(24, 'pronunciation_attempts')` AND the tables.
//
// Commit b4e0418 then renumbered the file to v26 with NO repair step, and asserted in
// three places that v24 "was never merged and never shipped". That claim is false for
// a database: the ledger row and the tables are on disk. `runMigrations` sees 26
// missing, runs v26's bare `CREATE TABLE pronunciation_visits`, and throws
// `table pronunciation_visits already exists`. `openDatabase` calls `runMigrations`
// unconditionally, so EVERY API route and `scripts/worker.ts` throw on boot — forever.
// The per-migration transaction rolls back cleanly (no torn schema), but nothing ever
// gets past it. Those comments are corrected in place; this module is the repair.
//
// WHY A RECONCILIATION RATHER THAN EDITING v26. Two shapes of fix were available:
// making v26's DDL `IF NOT EXISTS`, or reconciling the ledger before the loop. This
// repo forbids editing a shipped migration (CLAUDE.md), and v26 IS shipped on master —
// so the repair lives here, outside the migration list, where it can also state
// plainly what happened. It is also the more honest of the two: the defect is a
// mis-recorded LEDGER (a row claiming version 24 for work that is now version 26), and
// this fixes the ledger rather than teaching every future migration to shrug at
// pre-existing tables.
//
// It is NOT a migration: it is not versioned, it appends nothing to `_migrations`
// beyond correcting the row that is already wrong, and on a healthy database (fresh,
// or already at v26) it does nothing at all — one indexed lookup and out.
//
// NOTE (owed to E-39): migrations here are not intrinsically idempotent — every `up`
// uses bare `CREATE TABLE` / `ALTER TABLE ADD COLUMN` except the v17/v18 seeds — so the
// `_migrations` ledger is the SOLE idempotency mechanism. That is exactly why a wrong
// ledger row is unrecoverable rather than merely untidy.

/** The migration whose version changed under a database's feet. */
const STALE_VERSION = 24;
const RENUMBERED_VERSION = 26;
const MIGRATION_NAME = "pronunciation_attempts";

/**
 * The v26 end state, stated tolerantly. Both v24 variants are covered: the first
 * created only `pronunciation_attempts` (+2 indexes), so `pronunciation_visits` is
 * genuinely missing and gets created here; the second created all five objects, so
 * every statement is a no-op. The DDL is character-for-character v26's, with
 * `IF NOT EXISTS` added — `tests/migrations.test.ts` compares a reconciled database's
 * `sqlite_master` against a freshly migrated one, so drift between the two is caught.
 */
const V26_END_STATE = `
  CREATE TABLE IF NOT EXISTS pronunciation_visits (
    drill_key   TEXT PRIMARY KEY,
    finding_id  TEXT,
    cycles      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pronunciation_visits_finding ON pronunciation_visits(finding_id);
  CREATE TABLE IF NOT EXISTS pronunciation_attempts (
    id                  TEXT PRIMARY KEY,
    drill_key           TEXT NOT NULL,
    finding_id          TEXT,
    reference_text      TEXT NOT NULL,
    audio_path          TEXT NOT NULL,
    audio_seconds       REAL NOT NULL,
    result              TEXT NOT NULL,
    pron_score          REAL NOT NULL,
    accuracy_score      REAL NOT NULL,
    fluency_score       REAL NOT NULL,
    completeness_score  REAL NOT NULL,
    snr_db              REAL,
    low_snr             INTEGER NOT NULL DEFAULT 0,
    scorer_id           TEXT NOT NULL,
    cost_usd            REAL NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_drill ON pronunciation_attempts(drill_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_pronunciation_attempts_finding ON pronunciation_attempts(finding_id);
`;

/**
 * Repair a `_migrations` ledger that records the pronunciation migration under its
 * pre-renumber version. Completes the v26 end state (the earlier v24 variant is
 * missing `pronunciation_visits`), then replaces the `(24, …)` row with `(26, …)` so
 * the loop skips v26 instead of throwing on tables that already exist. Data in the
 * pre-existing tables is never dropped — a learner's attempts are their own history.
 *
 * One transaction: either the ledger and the schema both move, or neither does.
 * Returns true when a repair was performed (tests and the worker's startup log read
 * this), false on every healthy database.
 */
export function reconcileMigrationLedger(db: Database): boolean {
  const stale = db
    .prepare("SELECT 1 FROM _migrations WHERE version = ? AND name = ?")
    .get(STALE_VERSION, MIGRATION_NAME);
  if (!stale) return false;
  const already = db.prepare("SELECT 1 FROM _migrations WHERE version = ?").get(RENUMBERED_VERSION);

  const tx = db.transaction(() => {
    if (!already) db.exec(V26_END_STATE);
    db.prepare("DELETE FROM _migrations WHERE version = ? AND name = ?").run(STALE_VERSION, MIGRATION_NAME);
    if (!already) {
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(RENUMBERED_VERSION, MIGRATION_NAME);
    }
  });
  tx();
  return true;
}
