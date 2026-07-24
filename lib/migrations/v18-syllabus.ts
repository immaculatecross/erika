import type { Migration } from "./index";
import { seedGrammarSyllabus } from "../knowledge/seed-syllabus";

// E-26b The Italian grammar syllabus (D-19, D-23): seed `knowledge_items` with the
// prerequisite-ordered grammar curriculum so the future daily composer (v0.5/E-31)
// can introduce a rule only once the rules it depends on are being learned. The rows
// come from the committed, DAG-validated asset `lib/syllabus/grammar-it.json` — an
// original, authored A1→C2 rule set with a developed C1/C2 italiano-colto tail,
// structured after (not copied from) the Profilo della lingua italiana. No model
// call, no external fetch: the content is authored and shipped in the repo.
//
// This migration sets ONLY the reference columns `prereqs` (the DAG edges, as
// `rule:<key>` item ids) and `cefr` (the rule's CEFR level), idempotently and
// WITHOUT clobbering any derived/evidence-driven state (`recording_attested`,
// `srs_*`, `status`) — see `seedGrammarSyllabus`. The runner wraps each migration in
// a transaction, so the whole seed is one atomic step; re-running the migration on an
// existing DB is a no-op (the version is recorded), and calling the seed again by
// hand only refreshes the reference columns. The DAG is validated before any write.
//
// PARALLEL BATCH: E-26a (the frequency lexicon) owns migration v17; this syllabus
// migration is v18 as assigned up front. The dispatcher reconciles the trivial
// docs/schema.md + index.ts append-conflict when this PR rebases onto master after
// v17 lands. Additive; shipped once; touches only `rule:` rows (never lemma rows).
export const syllabusMigration: Migration = {
  version: 18,
  name: "syllabus_grammar_seed",
  up: (db) => {
    seedGrammarSyllabus(db);
  },
};
