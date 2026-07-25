import type { Migration } from "./index";

// E-37 Pronunciation studio (D-21). **Numbered v26, not v24**: E-38 merged first and
// shipped v25 (`streak_repairs`), so this was renumbered to keep the applied sequence
// monotonic — a database that already ran v25 must never then run a lower version. The
// two are functionally independent (pronunciation tables vs the repair ledger), but the
// runner and `tests/migrations.test.ts` are built on versions only ever increasing, and
// a latent ordering oddity is exactly what bites a future migration that DOES depend on
// order.
//
// **CORRECTION (RETRO-004 technical lens §C1).** This comment used to say the renumber
// was safe "precisely because v24 was never merged and never shipped". That was false
// where it counts — in a database. v24 was never merged to master, but it WAS applied:
// it ran on `feat/pronunciation-studio` (commit 5c32ac6, then 2bcc810), so every machine
// that started the app from that branch holds the `_migrations` row
// `(24, 'pronunciation_attempts')` and these tables. The renumber shipped with no repair
// step, and v26's bare `CREATE TABLE` below then threw `table pronunciation_visits
// already exists` on every boot, permanently bricking those databases. "Never merged" is
// not the same as "never applied", and only the second one makes a renumber free.
// The repair is `lib/migrations/reconcile.ts`, which runs before the migration loop and
// rewrites that stale ledger row to 26. This migration itself is deliberately unchanged.
//
// A scripted Italian drill is heard in a native
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
// `pronunciation_visits` — one row per drill the learner has actually WORKED, with no
//   scorer involved and no money at all. This is the shipped default's record of the
//   loop: hear the correct line → record → hear yourself back. It exists because the
//   studio's core experience does not require an Azure key, so the composer's notion of
//   "this correction has been practised" must not require one either. Without it a
//   pronunciation finding — which no longer gets a card — could never be spent on the
//   default path and would re-enter the daily plan forever.
//
//   Keyed by `drill_key` so completing the loop again is an idempotent upsert (it moves
//   `last_at` and bumps `cycles`, it does not accumulate rows). `finding_id` is nullable
//   and FK-free for the same reason as the attempts table: a visit is the learner's own
//   history and outlives the finding that prompted it. There are no scores here by
//   construction — a visit is the record of an activity, never a claim about quality.
//
// Additive only; no shipped migration is edited, and no existing table is touched.
export const pronunciationAttemptsMigration: Migration = {
  version: 26,
  name: "pronunciation_attempts",
  up: (db) => {
    db.exec(`
      CREATE TABLE pronunciation_visits (
        drill_key   TEXT PRIMARY KEY,
        finding_id  TEXT,
        cycles      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        last_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_pronunciation_visits_finding ON pronunciation_visits(finding_id);
    `);
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
