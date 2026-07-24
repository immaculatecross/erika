import type { Migration } from "./index";

// E-36 Speaker attribution (D-22). On-device speaker verification decides, per
// ingest segment, whether the speech is the enrolled user (the E-35 take), so that
// produced-lemma POSITIVE evidence is minted only for the user's OWN speech — a
// bystander/podcast/other person is never credited, and (recall-first, D-22) the
// user is never dropped. Nothing here uploads audio or embeddings: all acoustic
// processing is local.
//
// This migration adds four things, all additive:
//
//  segments.speaker_score / segments.is_user — the per-segment verdict. `is_user`
//    is NULLABLE and NULL means UNATTRIBUTED (no enrollment, the filter is off, the
//    model asset is absent, or a per-segment hiccup): a null verdict is treated as
//    the user downstream, so attribution is a best-effort FILTER, never a gate that
//    can silence a learner who hasn't enrolled. `speaker_score` is the max cosine
//    similarity over the segment's 3–5 s windows against the enrolled reference.
//
//  sessions.exclude_from_evidence — the manual "this recording isn't me" surface
//    (a RETRO-002 owed item). An excluded session mints NO produced-lemma positives
//    regardless of the acoustic verdict. Additive, defaults 0 (learn from it).
//
//  speaker_references — the cached reference embedding (centroid) for an enrollment
//    take under a given embedder. Keyed by (enrollment_id, embedder_id): a
//    re-enrollment mints a new take id, so its centroid is a cache MISS and is
//    recomputed — the old rows harmlessly linger (no FK; an enrollment take is not a
//    session, the spend_ledger precedent). The vector is stored as a JSON array of
//    numbers; `dim` and `window_count` are provenance for the dev inspector.
//
//  idx_evidence_produced_idem — a PARTIAL UNIQUE index over produced-lemma positive
//    evidence (source='finding', spontaneous, polarity=1), keyed by its idempotency
//    `source_ref` (<session>:<segment content_hash>:<lemma>#<POS>). Re-running a
//    deep-listen on the same segment re-emits the same key, and the writer uses
//    `INSERT OR IGNORE` — append-only-COMPATIBLE (a no-op insert, never an
//    UPDATE/DELETE the v14 triggers reject), so a replay appends no duplicate row (a
//    RETRO-002 owed item). The `source_ref IS NOT NULL` guard keeps every legacy
//    produced row (they carry a NULL ref) out of the index, so the index builds on
//    an existing DB without collapsing history.
export const speakerAttributionMigration: Migration = {
  version: 23,
  name: "speaker_attribution",
  up: (db) => {
    db.exec(`
      ALTER TABLE segments ADD COLUMN speaker_score REAL;
      ALTER TABLE segments ADD COLUMN is_user INTEGER;

      ALTER TABLE sessions ADD COLUMN exclude_from_evidence INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE speaker_references (
        enrollment_id TEXT NOT NULL,
        embedder_id   TEXT NOT NULL,
        dim           INTEGER NOT NULL,
        vector        TEXT NOT NULL,
        window_count  INTEGER NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (enrollment_id, embedder_id)
      );

      CREATE UNIQUE INDEX idx_evidence_produced_idem
        ON evidence (source_ref)
        WHERE source = 'finding' AND mode = 'spontaneous' AND polarity = 1
          AND source_ref IS NOT NULL;
    `);
  },
};
