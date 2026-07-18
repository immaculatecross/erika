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
  {
    // E-5 Flashcards (part 2): the delete tombstone. Deleting a card in the
    // browser records its `finding_id` here so the next idempotent
    // `generateCards` does NOT resurrect the card — a deleted card stays gone
    // while its finding lives. The FK cascade means a tombstone is cleaned up
    // when its finding (hence its session) is deleted, at which point there is
    // no finding left to regenerate a card from anyway.
    version: 6,
    name: "deleted_findings_tombstone",
    up: (db) => {
      db.exec(`
        CREATE TABLE deleted_findings (
          finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    // E-6 Micro-lessons (part 1): the lesson engine's persistence.
    //
    // `lessons` — one generated grammar lesson per recurring error *pattern*. A
    //   pattern key names the grouping the lesson targets; for v1 a pattern is a
    //   category with >= 3 findings, so the key is `category:<category>` (see
    //   lib/lessons/patterns.ts). `pattern_key` is UNIQUE so a lesson is generated
    //   once per pattern and re-opening it is a cache hit — no re-generation, no
    //   re-bill (WO criterion 4). `exercises` holds the typed exercise list as
    //   JSON (multiple_choice / fill_in / rewrite). No session FK: a lesson is
    //   derived from the whole finding history, not one session, and outlives any
    //   single session delete — like the hash-keyed spend ledger.
    // `lesson_mastery` — a per-pattern 0..1 mastery value, updated on lesson
    //   completion by the documented EMA rule (lib/lessons/mastery.ts).
    version: 7,
    name: "lessons_and_mastery",
    up: (db) => {
      db.exec(`
        CREATE TABLE lessons (
          id          TEXT PRIMARY KEY,
          pattern_key TEXT NOT NULL UNIQUE,
          explanation TEXT NOT NULL,
          exercises   TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE lesson_mastery (
          pattern_key TEXT PRIMARY KEY,
          mastery     REAL NOT NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    // E-16 Hardening (defect 2): the heartbeat lease and the findings identity key.
    //
    // Both job tables gain `worker_id` (who holds the lease) and `heartbeat_at`
    // (when that holder last proved it was alive). Before this, *every* row in
    // `processing` was reclaimable by anyone, so a second worker re-ran a job the
    // first was actively executing — double OpenAI spend and duplicate findings.
    // A claim now stamps both columns and each checkpoint refreshes the heartbeat;
    // reclaim only takes rows whose heartbeat is older than JOB_LEASE_STALE_MS
    // (lib/jobs/lease.ts). Legacy rows carry NULL, which reads as "no live lease"
    // and stays reclaimable — the pre-v8 behaviour for genuinely abandoned work.
    //
    // `idx_findings_identity` guards ONE narrow case: re-inserting the *exact
    // same finding* — same session, audio, timestamp, quote, correction and
    // category. It does NOT prevent the double-run race; the heartbeat lease does
    // that. Two independent model replies about the same speech routinely disagree
    // on the offset by a few hundred ms, which is a different key, so both would
    // persist. Read this as idempotence for a replayed write, nothing wider.
    //
    // `correction` and `category` are part of the key because `quote` names the
    // erroneous SPAN, not the finding: one utterance can legitimately carry a
    // grammar finding and a pronunciation finding with different corrections. A
    // narrower key would silently drop the second — and `relStartMs` is optional
    // in the deep-response contract (it defaults to 0), so a reply that omits
    // offsets collapses every finding in the segment onto the same `start_ms`.
    //
    // Writers use `ON CONFLICT DO NOTHING` against this index, which swallows only
    // the duplicate — a CHECK violation (bad category/severity) still throws and
    // still rolls its transaction back (E-4 atomicity). Existing duplicates are
    // collapsed before the index builds: the survivor is the oldest `created_at`,
    // ties broken by `id`, so the choice is deterministic across re-runs and
    // across machines. (`MIN(id)` alone would NOT be "earliest" — ids are random
    // UUID text, so its ordering is lexicographic and unrelated to insert time.)
    version: 8,
    name: "job_lease_and_findings_identity",
    up: (db) => {
      db.exec(`
        ALTER TABLE ingest_jobs   ADD COLUMN worker_id    TEXT;
        ALTER TABLE ingest_jobs   ADD COLUMN heartbeat_at TEXT;
        ALTER TABLE analysis_jobs ADD COLUMN worker_id    TEXT;
        ALTER TABLE analysis_jobs ADD COLUMN heartbeat_at TEXT;

        DELETE FROM findings WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY session_id, content_hash, start_ms, quote, correction, category
              ORDER BY created_at, id
            ) AS rn
            FROM findings
          ) WHERE rn = 1
        );
        CREATE UNIQUE INDEX idx_findings_identity
          ON findings (session_id, content_hash, start_ms, quote, correction, category);
      `);
    },
  },
  {
    // E-16b (criterion 4): one bad model reply must not kill the whole run.
    //
    // Previously any ModelParseError propagated out of the segment loop and landed
    // the entire job `failed` — "Analysis failed — Model response was not a JSON
    // object" — discarding a run that had already analysed (and paid for) every
    // other segment. A segment whose reply cannot be read after one repair retry is
    // now marked here and the run continues.
    //
    // `unreadable_reason` is the truthful error text; `response_shape` is a
    // content-free structural descriptor (finish_reason, length, brace state — see
    // describeResponseShape) so the failure distribution becomes visible without
    // storing model output, or anything the speaker said, in the database.
    //
    // The witness stays a cache row, so resume semantics are unchanged: an
    // unreadable DEEP keeps its triage verdict (flagged=1, deep_done=0) and a later
    // run resumes at the deep call without re-billing the triage, while an
    // unreadable TRIAGE (flagged=0) tells us nothing and is started over.
    version: 9,
    name: "segment_unreadable",
    up: (db) => {
      db.exec(`
        ALTER TABLE segment_analyses ADD COLUMN unreadable        INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE segment_analyses ADD COLUMN unreadable_reason TEXT;
        ALTER TABLE segment_analyses ADD COLUMN response_shape    TEXT;
      `);
    },
  },
  {
    // E-19 Profile-primed analysis: the deep model's prompt now carries the
    // speaker profile (lib/analysis/profile.ts), and its reply MAY cite one of
    // the numbered profile entries as the recurrence a finding repeats.
    //
    // `recurrence_of` persists that link: the cited entry's correction text —
    // stable across runs, unlike the run-local "R1" labels — or NULL. The field
    // is optional END TO END (D-13): a reply without it, or citing an unknown
    // entry, persists its finding with NULL exactly as every pre-v10 row reads.
    // Additive only; every existing row is untouched and reads as "no link".
    version: 10,
    name: "findings_recurrence",
    up: (db) => {
      db.exec(`
        ALTER TABLE findings ADD COLUMN recurrence_of TEXT;
      `);
    },
  },
  {
    // E-20 Slips, the fossil dossier: a recurring mistake becomes a persistent
    // *slip*. Findings that share a normalized correction + category cluster into
    // one slip with a stable, deterministic key (lib/slips.ts), folding in the
    // v10 `recurrence_of` links — which store the CLIPPED (≤60-char) correction, so
    // clustering prefix-matches rather than assuming string equality.
    //
    // `slips` persists the cluster; `finding_slips` is the finding→slip association
    // (one slip per finding: PK on `finding_id`, cascade on delete). Both are a
    // MATERIALIZATION of the pure clustering — `materializeSlips` rebuilds them
    // idempotently, keyed by `slip_key`, so re-analysing the same findings lands the
    // same rows with the same ids. Additive only: no existing table or row is
    // touched, and a slip's state (active / in remission / resolved) is COMPUTED
    // from later analysed sessions (lib/findings-model.ts semantics), never stored.
    version: 11,
    name: "slips",
    up: (db) => {
      db.exec(`
        CREATE TABLE slips (
          id         TEXT PRIMARY KEY,
          slip_key   TEXT NOT NULL UNIQUE,
          category   TEXT NOT NULL
                       CHECK (category IN ('grammar','vocabulary','phrasing','idiom','pronunciation')),
          correction TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE finding_slips (
          finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
          slip_id    TEXT NOT NULL REFERENCES slips(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_finding_slips_slip ON finding_slips(slip_id);
      `);
    },
  },
  {
    // E-21 Contrastive playback: the correction of a finding can be rendered once
    // in the audio model's voice (a TTS call) and kept forever, so the Compare
    // control plays your clip then the native rendering without ever re-billing.
    //
    // `renditions` — one row per finding whose correction has been rendered. The
    //   `finding_id` PK doubles as the cache key AND the INSERT-first concurrency
    //   guard: a double-clicked Generate cannot double-bill because the second
    //   INSERT hits the PK and the spend is recorded only by the transaction that
    //   won the row (lib/render/engine.ts). `path` is the on-disk mp3 under
    //   data/renditions/; `cost_usd` is the actual TTS charge, also ledgered once
    //   into the shared spend_ledger. FK cascade on delete: removing a finding
    //   (hence its session) drops the row — the file is cleaned up by the delete
    //   route, and playback is orphan-safe if it isn't (no crash on a missing file).
    //
    // PARALLEL-BATCH NOTE: E-20 (slips/Focus) holds migration v11 in the same
    // batch; this is numbered v12 as instructed and the dispatcher resolves final
    // ordering at merge. If this branch's runner only sees v10 at build time, the
    // number still stands — migrations are applied by ascending version, additive.
    version: 12,
    name: "renditions",
    up: (db) => {
      db.exec(`
        CREATE TABLE renditions (
          finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
          path       TEXT NOT NULL,
          cost_usd   REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];
