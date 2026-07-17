import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations } from "./migrations";

// The one SQLite entry point. Server-only — never import from a client
// component. Settings and every later table are read/written through the
// connection this module returns.

export type Db = Database.Database;

function defaultDbPath(): string {
  return process.env.ERIKA_DB_PATH ?? path.join(process.cwd(), "data", "erika.db");
}

/**
 * Apply every migration not yet recorded, in order, inside one transaction per
 * migration. Idempotent: a second call after the first applies nothing.
 * Returns the versions applied by this call.
 */
export function runMigrations(db: Db): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const done = new Set(
    db.prepare("SELECT version FROM _migrations").all().map((r) => (r as { version: number }).version),
  );
  const applied: number[] = [];
  const record = db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)");
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    const tx = db.transaction(() => {
      m.up(db);
      record.run(m.version, m.name);
    });
    tx();
    applied.push(m.version);
  }
  return applied;
}

/**
 * Open a fresh connection at `dbPath` (default: data/erika.db), creating the
 * parent directory if absent, and bring its schema up to date. Each call is an
 * independent connection — used by tests to simulate a reload.
 */
export function openDatabase(dbPath: string = defaultDbPath()): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

let singleton: Db | null = null;

/** Process-wide connection for the running app. */
export function getDb(): Db {
  if (!singleton) singleton = openDatabase();
  return singleton;
}
