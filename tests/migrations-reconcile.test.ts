import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase, runMigrations } from "@/lib/db";
import { migrations } from "@/lib/migrations";
import { reconcileMigrationLedger } from "@/lib/migrations/reconcile";

const tmpFiles: string[] = [];

function tmpDbPath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "erika-mig-rec-")), "erika.db");
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

// RETRO-004 technical lens §C1: a database that ran the E-37 pronunciation migration
// while it was numbered v24 must still boot. Two v24 variants really existed on
// `feat/pronunciation-studio` — 5c32ac6 created `pronunciation_attempts` + 2 indexes;
// 2bcc810 grew it to also create `pronunciation_visits` + its index — and both were
// applied to real machines before b4e0418 renumbered the file to v26 with no repair.
// Testing the fresh-DB path proves nothing here: that path already passed while every
// affected database threw `table pronunciation_visits already exists` on every boot.
// So these tests build the actual failure state and boot it.

/** The old v24's DDL, reconstructed from git. `visits` is the 2bcc810 variant. */
function applyOldV24(db: Database.Database, opts: { visits: boolean }): void {
  if (opts.visits) {
    db.exec(`
      CREATE TABLE pronunciation_visits (
        drill_key   TEXT PRIMARY KEY,
        finding_id  TEXT,
        cycles      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        last_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_pronunciation_visits_finding ON pronunciation_visits(finding_id);
    `);
  }
  db.exec(`
    CREATE TABLE pronunciation_attempts (
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
    CREATE INDEX idx_pronunciation_attempts_drill ON pronunciation_attempts(drill_key, created_at);
    CREATE INDEX idx_pronunciation_attempts_finding ON pronunciation_attempts(finding_id);
  `);
  db.prepare("INSERT INTO _migrations (version, name) VALUES (24, 'pronunciation_attempts')").run();
}

/** A database as `feat/pronunciation-studio` left it: v1…v23 applied, then the old v24. */
function brokenV24Db(p: string, opts: { visits: boolean }): Database.Database {
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const record = db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)");
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version >= 24) continue;
    m.up(db);
    record.run(m.version, m.name);
  }
  applyOldV24(db, opts);
  return db;
}

function versionsOf(db: Database.Database): number[] {
  return (db.prepare("SELECT version FROM _migrations ORDER BY version").all() as { version: number }[]).map(
    (r) => r.version,
  );
}

/** Every object the schema defines, as SQLite stores it — the drift check. */
function schemaOf(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
      .all() as { type: string; name: string; sql: string }[]
  ).map((r) => `${r.type} ${r.name} :: ${r.sql.replace(/\s+/g, " ").trim()}`);
}

describe("ledger reconciliation — a database that ran the pronunciation migration as v24", () => {
  for (const variant of [
    { label: "2bcc810 (both tables)", visits: true },
    { label: "5c32ac6 (attempts only)", visits: false },
  ]) {
    it(`boots clean and reaches v26 — variant ${variant.label}`, () => {
      const p = tmpDbPath();
      const broken = brokenV24Db(p, { visits: variant.visits });
      expect(versionsOf(broken)).toContain(24);
      broken.close();

      // The whole defect: this call threw, unconditionally, on every boot.
      const db = openDatabase(p);
      const versions = versionsOf(db);
      expect(versions).not.toContain(24); // the stale row is gone, not merely ignored
      expect(versions).toContain(26);
      expect(versions).toEqual([...migrations].map((m) => m.version).sort((a, b) => a - b));

      // Both tables exist, whichever variant we came from.
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      ).map((r) => r.name);
      expect(tables).toContain("pronunciation_visits");
      expect(tables).toContain("pronunciation_attempts");

      // Re-running is still a no-op, and a reopen still applies nothing.
      expect(runMigrations(db)).toEqual([]);
      db.close();
      const reopened = openDatabase(p);
      expect(runMigrations(reopened)).toEqual([]);
      reopened.close();
    });
  }

  it("leaves a reconciled database schema-identical to a fresh one (no DDL drift)", () => {
    const p = tmpDbPath();
    brokenV24Db(p, { visits: false }).close();
    const repaired = openDatabase(p);
    const fresh = openDatabase(tmpDbPath());
    // The reconciliation restates v26's DDL with IF NOT EXISTS; if the two ever drift,
    // a repaired database quietly diverges from a fresh one. Compare the whole schema.
    expect(schemaOf(repaired).map((s) => s.replace(" IF NOT EXISTS", ""))).toEqual(schemaOf(fresh));
    repaired.close();
    fresh.close();
  });

  it("keeps the learner's pre-existing attempts — the repair drops no data", () => {
    const p = tmpDbPath();
    const broken = brokenV24Db(p, { visits: true });
    broken
      .prepare(
        `INSERT INTO pronunciation_attempts
           (id, drill_key, finding_id, reference_text, audio_path, audio_seconds, result,
            pron_score, accuracy_score, fluency_score, completeness_score, scorer_id, cost_usd)
         VALUES ('a1','finding:f1','f1','Ciao.','/tmp/a1.wav',1.0,'{}',90,90,90,90,'fixture',0)`,
      )
      .run();
    broken.close();

    const db = openDatabase(p);
    const kept = db.prepare("SELECT id FROM pronunciation_attempts").all() as { id: string }[];
    expect(kept.map((r) => r.id)).toEqual(["a1"]);
    db.close();
  });

  it("is a no-op on a healthy database", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    const before = versionsOf(db);
    expect(reconcileMigrationLedger(db)).toBe(false);
    expect(versionsOf(db)).toEqual(before);
    db.close();
  });
});
