import type { Migration } from "./index";

// E-37 Pronunciation studio (D-21). A scripted Italian drill is heard in a native
// rendition, re-recorded by the learner, and scored by Azure Pronunciation Assessment
// (it-IT) at word AND phoneme granularity. This migration persists the attempts so
// progress is inspectable and every drill is re-attemptable.
//
// `pronunciation_attempts` — one row per SCORED take (a cap refusal or a provider
//   failure stores nothing: there is no score to store, and the money path records the
//   refusal by simply not charging). It holds:
//
//     * `drill_key` / `finding_id` — what was drilled. `finding_id` is deliberately
//       NOT a foreign key: an attempt is the learner's own history and must outlive
//       the finding that prompted it (the `evidence.source_ref` / `spend_ledger`
//       precedent — deleting a session must not erase what the learner did). It is
//       nullable so a non-finding drill can be added later without a migration.
//     * `reference_text` — the exact scripted sentence assessed. Stored verbatim
//       because it is what the score MEANS; a later edit to the finding must not
//       silently re-interpret an old score.
//     * `result` — the whole parsed `PronunciationResult` as JSON: per-word and
//       per-phoneme accuracy, error types, n-best alternates, and the 100-ns offset/
//       duration ticks that align each word to the learner's own audio. Stored whole
//       so a re-render of the feedback never needs the provider again.
//     * the four headline scores as columns (`pron_score`, `accuracy_score`,
//       `fluency_score`, `completeness_score`) for cheap aggregates. There is NO
//       prosody column: prosody is en-US only, so Italian never has one (OBS-002).
//     * `snr_db` + `low_snr` — the re-record gate. A take below the SNR threshold is
//       stored (it was billed) but its scores are never presented as valid: PA quality
//       is bounded by input quality, so a noisy take scores the room, not the learner.
//     * `audio_path` — the learner's take under `data/pronunciation/` (gitignored,
//       like every other recording). Playback of a single word slice is a seek into
//       this file using the stored ticks.
//     * `scorer_id` + `cost_usd` — provenance and the actual charge (also ledgered
//       once, `pa:<attempt id>`). `scorer_id` is what keeps a fixture-sourced score
//       from ever being mistaken for a real one.
//
// Additive only; no shipped migration is edited, and no existing table is touched.
export const pronunciationAttemptsMigration: Migration = {
  version: 24,
  name: "pronunciation_attempts",
  up: (db) => {
    db.exec(`
      CREATE TABLE pronunciation_attempts (
        id                  TEXT PRIMARY KEY,
        drill_key           TEXT NOT NULL,
        finding_id          TEXT,
        reference_text      TEXT NOT NULL,
        audio_path          TEXT NOT NULL,
        audio_seconds       REAL NOT NULL,
        result              TEXT NOT NULL,
        pron_score          REAL NOT NULL,
        accuracy_score      REAL NOT NULL,
        fluency_score       REAL NOT NULL,
        completeness_score  REAL NOT NULL,
        snr_db              REAL,
        low_snr             INTEGER NOT NULL DEFAULT 0,
        scorer_id           TEXT NOT NULL,
        cost_usd            REAL NOT NULL,
        created_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_pronunciation_attempts_drill ON pronunciation_attempts(drill_key, created_at);
      CREATE INDEX idx_pronunciation_attempts_finding ON pronunciation_attempts(finding_id);
    `);
  },
};
