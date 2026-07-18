import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase, runMigrations } from "@/lib/db";
import { migrations } from "@/lib/migrations";

const tmpFiles: string[] = [];

function tmpDbPath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "erika-mig-")), "erika.db");
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

describe("migrations runner", () => {
  it("creates the schema and records applied versions", () => {
    const db = openDatabase(tmpDbPath());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("settings");
    expect(tables).toContain("_migrations");
    const versions = db
      .prepare("SELECT version FROM _migrations")
      .all()
      .map((r) => (r as { version: number }).version);
    expect(versions).toContain(1);
    db.close();
  });

  it("is idempotent — a second run applies nothing", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    // openDatabase already ran migrations once; run again explicitly.
    const secondRun = runMigrations(db);
    expect(secondRun).toEqual([]);
    const count = db.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number };
    expect(count.n).toBe(migrations.length);
    db.close();

    // And a fresh connection to the same file applies nothing new either.
    const reopened = openDatabase(p);
    const applied = runMigrations(reopened);
    expect(applied).toEqual([]);
    reopened.close();
  });

  it("v8 adds the lease columns and the findings identity index (E-16)", () => {
    const db = openDatabase(tmpDbPath());
    for (const table of ["ingest_jobs", "analysis_jobs"]) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain("worker_id");
      expect(cols).toContain("heartbeat_at");
    }
    const idx = (db.prepare("PRAGMA index_list(findings)").all() as { name: string; unique: number }[]).find(
      (i) => i.name === "idx_findings_identity",
    );
    expect(idx?.unique).toBe(1);
    db.close();
  });

  it("v8 collapses pre-existing duplicate findings so the unique index can build", () => {
    // A database written before the lease landed may already carry duplicates
    // from a double-run. Migrating must dedupe rather than fail to apply.
    const p = tmpDbPath();
    const upTo7 = migrations.filter((m) => m.version <= 7);
    const db = openDatabase(p);
    db.close();

    // Rebuild a v7-era database and plant a duplicate pair.
    fs.rmSync(p);
    const legacy = new Database(p);
    legacy.exec(`CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    for (const m of upTo7) {
      m.up(legacy);
      legacy.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(m.version, m.name);
    }
    legacy
      .prepare(
        `INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds)
         VALUES ('s1', 't.wav', 'wav', 1, 60)`,
      )
      .run();
    const ins = legacy.prepare(
      `INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
       VALUES (?, 's1', 'h', 'dup', 'fix', 'grammar', 'why', 'low', 1000, 2000)`,
    );
    ins.run("a");
    ins.run("b"); // the duplicate a double-run would have written
    expect((legacy.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n).toBe(2);
    legacy.close();

    const migrated = openDatabase(p); // applies v8
    const rows = migrated.prepare("SELECT id FROM findings").all() as { id: string }[];
    expect(rows).toEqual([{ id: "a" }]); // earliest row kept, duplicate collapsed
    migrated.close();
  });
});
