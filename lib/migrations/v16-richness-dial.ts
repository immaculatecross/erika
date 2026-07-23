import type { Migration } from "./index";

// E-28 The richness dial (D-20, D-19): the short-capture full-deep path returns an
// ENRICHED deep reply, and the deep pass now also emits correctly-produced lemmas
// written as positive production evidence. Two additive columns carry that.
//
// `findings.notes` — the enriched observations channel (D-20). The deep prompt now
//   also asks, per finding, for a pronunciation-suspect note, an italiano-colto
//   register-upgrade suggestion, and a disfluency note. Rather than widen the
//   closed `category` CHECK (which every category-switching surface — Focus, slips,
//   lessons, cards — would have to learn), the enrichment rides as a small JSON
//   object in a nullable `notes` column ON the finding it annotates. NULL on every
//   pre-v16 row and on any finding the model returned no enrichment for; the JSON
//   is `{pronunciation?, register?, disfluency?}`, each an optional short string.
//   (The PR states this "notes channel vs. new categories" choice and its reason.)
// `knowledge_items.recording_attested` — the mark (D-19) that a lemma was produced
//   CORRECTLY in a recording (a spontaneous, audio-derived, finding-sourced positive
//   evidence row exists for it), so the future daily composer (v0.5/E-31) can EXCLUDE
//   it from new-item selection — Record teaches the model the user's real vocabulary.
//   It is a DERIVED flag: rebuildable from the evidence log alone (like the srs_*/
//   status cache, lib/knowledge/derive.ts), so wiping it and rebuilding restores it.
//   DEFAULT 0 so every pre-v16 item reads exactly as before. Additive, shipped once.
export const richnessDialMigration: Migration = {
  version: 16,
  name: "finding_notes_and_recording_attested",
  up: (db) => {
    db.exec(`
      ALTER TABLE findings ADD COLUMN notes TEXT;
      ALTER TABLE knowledge_items ADD COLUMN recording_attested INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
