import type { Database } from "better-sqlite3";

// Ordered, append-only migrations. Each `up` is a pure DDL step; the runner in
// lib/db.ts applies pending versions in order and records them in _migrations.
// Never edit a shipped migration — add a new one. Reused by E-2…E-5.
export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "settings",
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    // E-2 Capture (part 1): a session is one uploaded audio file on disk; an
    // ingest_job tracks its processing state (E-3 drives it past 'queued').
    // Deleting a session cascades its jobs; its files are removed explicitly.
    version: 2,
    name: "sessions_and_ingest_jobs",
    up: (db) => {
      db.exec(`
        CREATE TABLE sessions (
          id                TEXT PRIMARY KEY,
          original_filename TEXT NOT NULL,
          format            TEXT NOT NULL,
          size_bytes        INTEGER NOT NULL,
          duration_seconds  REAL NOT NULL,
          created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE ingest_jobs (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          state      TEXT NOT NULL DEFAULT 'queued'
                       CHECK (state IN ('queued', 'processing', 'done', 'failed')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_ingest_jobs_session ON ingest_jobs(session_id);
      `);
    },
  },
];
