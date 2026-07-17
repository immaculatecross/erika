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
  {
    // E-4 Analysis (part 1): the cascade engine's persistence (D-10, D-3).
    //
    // `findings` — one correction for the dominant speaker, keyed to the session
    //   (FK cascade on delete) and to the segment's `content_hash` so the same
    //   audio's findings can be reused across sessions without a re-analysis.
    // `analysis_jobs` — an async run per session, mirroring ingest_jobs' shape
    //   (state/stage/progress/error) plus a `halted` state for the budget cap.
    // `segment_analyses` — the never-re-bill witness: one row per `content_hash`
    //   once that audio has been triaged (and deep-listened if it was flagged).
    //   Hash-keyed and shared across sessions like the E-3 rendition cache, so it
    //   is retained when a single session is deleted (another may still key it).
    // `spend_ledger` — one row per real billable model call (cached calls record
    //   nothing), with a 'YYYY-MM' month key for the budget cap. Deliberately has
    //   NO session FK: deleting a session must never erase spend history.
    version: 4,
    name: "findings_analysis_jobs_spend_ledger",
    up: (db) => {
      db.exec(`
        CREATE TABLE findings (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          content_hash TEXT NOT NULL,
          quote        TEXT NOT NULL,
          correction   TEXT NOT NULL,
          category     TEXT NOT NULL
                         CHECK (category IN ('grammar','vocabulary','phrasing','idiom','pronunciation')),
          explanation  TEXT NOT NULL,
          severity     TEXT NOT NULL CHECK (severity IN ('high','medium','low')),
          start_ms     INTEGER NOT NULL,
          end_ms       INTEGER NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_findings_session ON findings(session_id);
        CREATE INDEX idx_findings_hash ON findings(content_hash);

        CREATE TABLE analysis_jobs (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          state      TEXT NOT NULL DEFAULT 'queued'
                       CHECK (state IN ('queued','processing','done','failed','halted')),
          stage      TEXT,
          progress   REAL NOT NULL DEFAULT 0,
          error      TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );
        CREATE INDEX idx_analysis_jobs_session ON analysis_jobs(session_id);

        CREATE TABLE segment_analyses (
          content_hash TEXT PRIMARY KEY,
          flagged      INTEGER NOT NULL,
          deep_done    INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE spend_ledger (
          id           TEXT PRIMARY KEY,
          month        TEXT NOT NULL,
          model        TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          cost_usd     REAL NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_spend_ledger_month ON spend_ledger(month);
      `);
    },
  },
  {
    // E-5 Flashcards (part 1): the drill loop's persistence. One `card` per
    // finding — created once, deduplicated by the `finding_id` UNIQUE key, and
    // cascade-deleted when its finding (hence its session) goes. `front`/`back`
    // carry the rendered study text (quote → correction + why); `session_id`,
    // `category`, `start_ms` are copied for the browser and later jump-to-audio.
    // The SM-2 scheduler state (`ease`/`interval_days`/`repetitions`/`due`/
    // `last_grade`, see lib/srs.ts) advances on each grade. `suspended` is written
    // now but its UI arrives in E-5b (WO-flashcards-manage). `due` is a
    // SQLite-comparable UTC timestamp so the due queue is a plain `due <= now`.
    version: 5,
    name: "cards",
    up: (db) => {
      db.exec(`
        CREATE TABLE cards (
          id            TEXT PRIMARY KEY,
          finding_id    TEXT NOT NULL UNIQUE REFERENCES findings(id) ON DELETE CASCADE,
          session_id    TEXT NOT NULL,
          front         TEXT NOT NULL,
          back          TEXT NOT NULL,
          category      TEXT NOT NULL,
          start_ms      INTEGER NOT NULL,
          ease          REAL NOT NULL DEFAULT 2.5,
          interval_days INTEGER NOT NULL DEFAULT 0,
          repetitions   INTEGER NOT NULL DEFAULT 0,
          due           TEXT NOT NULL,
          last_grade    TEXT,
          suspended     INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_cards_due ON cards(due);
        CREATE INDEX idx_cards_session ON cards(session_id);
      `);
    },
  },
];
