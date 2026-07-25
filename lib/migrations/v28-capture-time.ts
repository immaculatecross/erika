import type { Migration } from "./index";

// E-42 · v28 — a real capture timestamp.
//
// `sessions.created_at` is the instant the ROW was made, i.e. when the upload
// finished. Erika's capture is day-scale and asynchronous by design (D-9), so
// "when the row was made" and "when the learner spoke" routinely differ by hours:
// a take recorded at 08:10 and uploaded at 21:30 was reported as an evening
// recording, and Focus's local-hour histogram was wrong with it. RETRO-004 §1
// named it; it is also the FIFTH of v0.6's five mirror-image repairs — E-38 keyed
// "today's thread" on capture time and then read the upload instant for it.
//
// `captured_at` is the instant the learner SPOKE (SQLite UTC text, the same shape
// as `created_at`). Its sources, in order of authority, are resolved once at
// finalize time in lib/capture-time.ts — the mic recorder's take-start instant,
// then a file's embedded `creation_time` via ffprobe, then the file's own
// modification time as a hint, then the upload instant as the floor.
//
// NULLABLE, deliberately. SQLite cannot add a NOT NULL column with a non-constant
// default (`datetime('now')` is not constant), so the column is added nullable and
// every existing row is BACKFILLED to `created_at` — the best value that exists for
// a recording captured before this column did. Readers go through
// `capturedAtSql()` (lib/capture-time.ts), which coalesces to `created_at`, so a
// NULL can never silently drop a session out of a histogram or a day bucket.
//
// Additive only: no shipped migration is edited (a v0.6 renumber left a permanently
// unbootable database), and nothing about `created_at` changes — it keeps meaning
// exactly what it always meant, which is why both columns exist.
export const captureTimeMigration: Migration = {
  version: 28,
  name: "session_capture_time",
  up: (db) => {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN captured_at TEXT;
      UPDATE sessions SET captured_at = created_at WHERE captured_at IS NULL;
      CREATE INDEX idx_sessions_captured ON sessions(captured_at);
    `);
  },
};
