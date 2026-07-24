import type { Migration } from "./index";
import { seedFrequencyLexicon } from "../knowledge/seed-lexicon";

// E-26a The Italian frequency lexicon (D-19): seed `knowledge_items` with a
// comprehensive, license-clean lemma inventory so the future daily composer
// (v0.5/E-31) has a real, frequency-ordered well to draw new items from at the
// learner's edge. The rows come from the committed, reduced asset
// `lib/lexicon/frequency-lexicon.tsv.gz` — FrequencyWords' OpenSubtitles-2018
// wordform frequencies (CC BY-SA) lemmatized through the Morph-it! map (CC BY-SA)
// and summed to lemma frequencies, every survivor gated by the E-25 morph-it
// validator. No CC BY-NC data (Kelly/itWaC/spaCy) is anywhere in the path.
//
// This migration sets ONLY the reference columns `freq_rank` and `cefr` (a coarse
// frequency band, NOT a measured CEFR level), idempotently and WITHOUT clobbering
// any derived/evidence-driven state (`recording_attested`, `srs_*`, `status`) — see
// `seedFrequencyLexicon`. The runner already wraps each migration in a transaction,
// so the whole seed is one atomic step; re-running the migration on an existing DB
// is a no-op (the version is recorded), and calling the seed again by hand only
// refreshes the reference columns. No model calls; deterministic and rebuildable.
export const lexiconMigration: Migration = {
  version: 17,
  name: "lexicon_frequency_seed",
  up: (db) => {
    seedFrequencyLexicon(db);
  },
};
