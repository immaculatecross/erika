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
  {
    // E-3 Smart ingest (part 1): the async speech-extraction pipeline.
    // `segments` holds each kept speech interval — original-timeline timestamps,
    // an ordered index, and a SHA-256 content hash that is the dedup/cache key.
    // `ingest_jobs` gains checkpoint columns so a killed worker resumes exactly
    // where it stopped: a fine-grained `stage`, a 0–1 `progress`, an `error`
    // string for the failed path, and `updated_at`. The coarse `state`
    // (queued/processing/done/failed) the UI already reads is left untouched.
    version: 3,
    name: "segments_and_job_checkpoints",
    up: (db) => {
      db.exec(`
        CREATE TABLE segments (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          idx          INTEGER NOT NULL,
          start_ms     INTEGER NOT NULL,
          end_ms       INTEGER NOT NULL,
          duration_ms  INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (session_id, idx)
        );
        CREATE INDEX idx_segments_session ON segments(session_id);
        CREATE INDEX idx_segments_hash ON segments(content_hash);

        ALTER TABLE ingest_jobs ADD COLUMN stage TEXT;
        ALTER TABLE ingest_jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0;
        ALTER TABLE ingest_jobs ADD COLUMN error TEXT;
        ALTER TABLE ingest_jobs ADD COLUMN updated_at TEXT;
      `);
    },
  },
];
