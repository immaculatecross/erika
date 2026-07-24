import type { Migration } from "./index";

// E-35 Placement onboarding (D-22). The ~45 s voice enrollment take that E-36's
// speaker attribution will match segments against. E-35 only CAPTURES and STORES it;
// the sherpa-onnx embeddings/centroid/filtering are E-36.
//
// `enrollment_takes` — one row per recorded take. The audio itself lives on disk
//   under data/enrollment/ (gitignored, like every other captured file) and, per
//   D-22, is ON-DEVICE ONLY — bystander/enrollment voice never leaves the device,
//   so there is no upload, no hosting, no external side effect anywhere on this
//   path. The row is metadata: `path` (the on-disk file), `format`, `duration_seconds`,
//   `size_bytes`, `created_at`. It is deliberately NOT a session and carries NO
//   ingest/analysis job: an enrollment take is never analyzed as findings — it is a
//   voice sample, not speech to correct.
//
// RE-RECORDABLE: re-enrollment simply inserts another row; the LATEST take (newest
// `created_at`) is the active enrollment E-36 reads. Keeping the history is cheap
// and lets a re-enrollment be undone/audited. No FK — an enrollment take outlives
// any session (it belongs to the person, not a recording), the `spend_ledger`
// precedent. `idx_enrollment_takes_created` serves the "latest" read.
export const enrollmentMigration: Migration = {
  version: 22,
  name: "enrollment_takes",
  up: (db) => {
    db.exec(`
      CREATE TABLE enrollment_takes (
        id               TEXT PRIMARY KEY,
        path             TEXT NOT NULL,
        format           TEXT NOT NULL,
        duration_seconds REAL NOT NULL,
        size_bytes       INTEGER NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_enrollment_takes_created ON enrollment_takes(created_at DESC);
    `);
  },
};
