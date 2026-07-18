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

  it("v10 adds nullable recurrence_of to findings (E-19, additive only)", () => {
    const db = openDatabase(tmpDbPath());
    const cols = db.prepare("PRAGMA table_info(findings)").all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];
    const col = cols.find((c) => c.name === "recurrence_of");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0); // optional everywhere — a pre-v10 row reads NULL
    db.close();
  });

  it("v13 adds ask_notes keyed by finding_id, cascading on finding delete (E-23)", () => {
    const db = openDatabase(tmpDbPath());
    const cols = (db.prepare("PRAGMA table_info(ask_notes)").all() as { name: string; pk: number }[]);
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["finding_id", "note", "cited_ids", "cost_usd", "created_at"]),
    );
    expect(cols.find((c) => c.name === "finding_id")?.pk).toBe(1);

    // A note cascades away when its finding (hence its session) is deleted.
    db.prepare(`INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds)
                VALUES ('s1', 't.wav', 'wav', 1, 60)`).run();
    db.prepare(`INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
                VALUES ('f1', 's1', 'h', 'q', 'c', 'grammar', 'why', 'low', 0, 1)`).run();
    db.prepare("INSERT INTO ask_notes (finding_id, note, cited_ids, cost_usd) VALUES ('f1', 'n', '[\"f2\"]', 0.001)").run();
    db.prepare("DELETE FROM sessions WHERE id = 's1'").run();
    expect((db.prepare("SELECT COUNT(*) AS n FROM ask_notes").get() as { n: number }).n).toBe(0);
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
    ins.run("b"); // the byte-identical row a replayed write would have left
    // Same span, genuinely different finding — must SURVIVE the dedupe, because
    // `quote` names the erroneous span, not the finding.
    legacy
      .prepare(
        `INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
         VALUES ('c', 's1', 'h', 'dup', 'other fix', 'pronunciation', 'why', 'low', 1000, 2000)`,
      )
      .run();
    expect((legacy.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n).toBe(3);
    legacy.close();

    const migrated = openDatabase(p); // applies v8
    const rows = migrated.prepare("SELECT id FROM findings ORDER BY id").all() as { id: string }[];
    // Oldest created_at wins, ties broken by id — deterministic, and 'c' is not a
    // duplicate under the widened key so it is untouched.
    expect(rows).toEqual([{ id: "a" }, { id: "c" }]);
    migrated.close();
  });
});

// E-17 criterion 3: docs/schema.md is bound to the migration ritual mechanically,
// not by good intentions. A schema doc that lags the schema is worse than none —
// it is believed, and it is wrong. Adding a migration therefore fails the suite
// until the doc names it and states the new latest version.
describe("docs/schema.md tracks the migrations", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "schema.md"), "utf8");

  it("names every migration by version and name", () => {
    for (const m of migrations) {
      expect(doc).toContain(`\`${m.name}\``);
      expect(doc).toMatch(new RegExp(`\\|\\s*${m.version}\\s*\\|\\s*\`${m.name}\``));
    }
  });

  it("states the current latest version", () => {
    const latest = Math.max(...migrations.map((m) => m.version));
    expect(doc).toContain(`Latest version: v${latest}.`);
  });

  it("documents every table the schema actually creates", () => {
    const db = openDatabase(tmpDbPath());
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith("sqlite_") && n !== "_migrations");
    for (const t of tables) expect(doc).toContain(`\`${t}\``);
    db.close();
  });
});
