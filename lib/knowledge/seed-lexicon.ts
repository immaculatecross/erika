import type { Db } from "../db";
import { lemmaItemId } from "./items";
import { loadFrequencyLexicon } from "../lexicon/frequency-lexicon";

// Seeding the frequency lexicon into `knowledge_items` (E-26a, D-19). The v17
// migration calls this; a test calls it directly against a throwaway DB. It reads
// the committed, morph-it-validated asset (lib/lexicon/frequency-lexicon.ts) and
// upserts one lemma row per `(lemma, POS)`, setting ONLY the reference columns
// `freq_rank` and `cefr` (the coarse frequency band).
//
// IDEMPOTENT and NON-CLOBBERING (the WO's hard contract). Every knowledge_items
// column other than the reference pair is DERIVED/evidence-driven state — a
// rebuildable cache (`srs_*`, `status`, `recording_attested`, `lib/knowledge/
// derive.ts`) or an append-only-log projection. So the upsert:
//   INSERT ... ON CONFLICT(id) DO UPDATE SET freq_rank, cefr  -- and NOTHING else
// A row E-28 already minted for a recording-produced lemma keeps its
// `recording_attested` mark, its SRS triple, and its `status`; only its reference
// columns are (re)written. A fresh row is inserted with the seed's freq_rank/cefr
// and the schema defaults for everything else (status 'unseen', recording_attested 0).
//
// The lemma gate stays `attestsLemma` (E-25): every row in the asset was accepted
// by it at BUILD time (scripts/build-lexicon.ts), so no unattested lemma can enter
// here — the asset is a pre-validated, license-clean subset of what the validator
// attests. `tests/lexicon-seed.test.ts` re-asserts that invariant on the seeded rows.

/** Seed (or refresh) the frequency lexicon; returns the number of rows upserted. */
export function seedFrequencyLexicon(db: Db): number {
  const records = loadFrequencyLexicon();
  const upsert = db.prepare(
    `INSERT INTO knowledge_items (id, kind, lemma, pos, freq_rank, cefr)
       VALUES (@id, 'lemma', @lemma, @pos, @freqRank, @band)
     ON CONFLICT(id) DO UPDATE SET
       freq_rank = excluded.freq_rank,
       cefr      = excluded.cefr`,
  );
  const tx = db.transaction((rows: typeof records) => {
    for (const r of rows) {
      upsert.run({
        id: lemmaItemId(r.lemma, r.pos),
        lemma: r.lemma,
        pos: r.pos,
        freqRank: r.freqRank,
        band: r.band,
      });
    }
  });
  tx(records);
  return records.length;
}
