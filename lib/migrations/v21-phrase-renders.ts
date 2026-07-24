import type { Migration } from "./index";

// E-33 Voice & canon. The per-phrase TTS render cache: one row per CORRECT Italian
// phrase (a finding's recast, a lesson example, or a canon passage) rendered to
// audio for the listen-and-shadow and reading/listening formats. Extracted into its
// own module to keep lib/migrations/index.ts under the 500-line hook.
//
// `phrase_renders` — keyed by `hash` (a SHA-256 of the phrase text + register +
//   voice, lib/render/phrase-renders.ts). The PRIMARY KEY is the render-once cache
//   key AND the render lease, exactly like E-21 `renditions.finding_id`: the engine
//   claims the row (INSERT) BEFORE the budget check and the provider call
//   (lease-before-spend), so a concurrent double-render makes at most one billable
//   call — the racing loser detects the claim and returns without a call and without
//   a ledger row (D-15). A claim that never commits (budget refusal / failed
//   synthesize) is released so a retry can re-lease. `path` is the on-disk mp3 under
//   data/phrase-renders/; `cost_usd` is the actual TTS charge, also ledgered ONCE
//   into the shared spend_ledger under the SAME cap (WO criterion 4 — one biller, no
//   second money path). `text`/`register` are kept for provenance and so a cache
//   entry is self-describing; they are never the cache key on their own.
//
// UNLIKE renditions there is NO finding FK — a phrase render outlives any one
// finding or session (a canon passage has no finding at all), so like the
// spend_ledger it is deliberately FK-free and keyed only by its content hash. Its
// files are hash-named and cross-format-shared, so a session delete never removes
// them (another format may still key the phrase); orphan cleanup is a future
// data/cache eviction concern (E-39), the segment-cache precedent.
export const phraseRendersMigration: Migration = {
  version: 21,
  name: "phrase_renders_cache",
  up: (db) => {
    db.exec(`
      CREATE TABLE phrase_renders (
        hash       TEXT PRIMARY KEY,
        text       TEXT NOT NULL,
        register   TEXT NOT NULL,
        path       TEXT NOT NULL,
        cost_usd   REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
