import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { attestsLemma } from "@/lib/lexicon/morphit";
import { isPos } from "@/lib/lexicon/pos";
import { loadFrequencyLexicon, rankToBand } from "@/lib/lexicon/frequency-lexicon";
import { seedFrequencyLexicon } from "@/lib/knowledge/seed-lexicon";
import { ensureLemmaItem, recordEvidence } from "@/lib/knowledge";

// The frequency lexicon seed (E-26a, D-19). The committed asset is the oracle
// (D-13): a real SQLite file per test, migrated (which runs the v17 seed) and torn
// down after. These prove the criterion-4 properties on the REAL data, not a fixture.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-lexicon-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface Row {
  id: string;
  lemma: string;
  pos: string;
  freq_rank: number | null;
  cefr: string | null;
  status: string;
  recording_attested: number;
  srs_stability: number | null;
}

function lemmaRows(db: Db): Row[] {
  return db
    .prepare("SELECT id, lemma, pos, freq_rank, cefr, status, recording_attested, srs_stability FROM knowledge_items WHERE kind = 'lemma' AND freq_rank IS NOT NULL")
    .all() as Row[];
}

describe("the frequency lexicon asset", () => {
  it("carries a comprehensive, well-above-floor inventory of dense-ranked rows", () => {
    const records = loadFrequencyLexicon();
    // The operator directive: comprehensive, well past the 15k floor.
    expect(records.length).toBeGreaterThanOrEqual(15_000);

    const ranks = records.map((r) => r.freqRank).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1); // rank 1 present
    expect(new Set(ranks).size).toBe(ranks.length); // unique
    expect(ranks[ranks.length - 1]).toBe(ranks.length); // dense 1..N, no gaps
  });

  it("every row is a morph-it-validated (lemma, POS) — attestsLemma stays the gate", () => {
    for (const r of loadFrequencyLexicon()) {
      expect(isPos(r.pos)).toBe(true);
      expect(attestsLemma(r.lemma, r.pos)).toBe(true);
      expect(r.band).toBe(rankToBand(r.freqRank)); // band is frequency-derived
    }
  });
});

describe("the v17 seed populates knowledge_items (criterion 4)", () => {
  it("seeds >= the stated floor of morph-it-validated, frequency-ordered lemma rows", () => {
    const db = freshDb();
    const rows = lemmaRows(db);
    expect(rows.length).toBeGreaterThanOrEqual(15_000);

    // Frequency-ordered: rank 1 present, ranks unique & dense over the seeded rows.
    const ranks = rows.map((r) => r.freq_rank!).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks[ranks.length - 1]).toBe(ranks.length);

    // Every seeded lemma row is attested (the gate ran at build time).
    for (const r of rows) expect(attestsLemma(r.lemma, r.pos)).toBe(true);

    // cefr carries the coarse frequency band, never NULL for a seeded row.
    for (const r of rows) expect(r.cefr).toBe(rankToBand(r.freq_rank!));
  });

  it("places known high-frequency lemmas at low ranks", () => {
    const db = freshDb();
    const rank = (id: string) =>
      (db.prepare("SELECT freq_rank FROM knowledge_items WHERE id = ?").get(id) as { freq_rank: number } | undefined)?.freq_rank;
    for (const id of ["lemma:essere#VERB", "lemma:fare#VERB", "lemma:dire#VERB"]) {
      const r = rank(id);
      expect(r).toBeDefined();
      expect(r!).toBeLessThan(500); // the workhorses sit near the top
    }
  });

  it("admits no proper noun and no fabricated / non-attested token", () => {
    const db = freshDb();
    // No PROPN rows anywhere (proper nouns are stoplisted at build time).
    expect((db.prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE pos = 'PROPN'").get() as { n: number }).n).toBe(0);
    // A fabricated lemma the validator rejects is absent.
    expect(db.prepare("SELECT 1 FROM knowledge_items WHERE lemma = 'zzzfoo'").get()).toBeUndefined();
    // 'roma' is a proper noun in this corpus (a city) — no PROPN row for it.
    expect(db.prepare("SELECT 1 FROM knowledge_items WHERE lemma = 'roma' AND pos = 'PROPN'").get()).toBeUndefined();
  });
});

describe("the seed is idempotent and never clobbers derived / evidence-driven state", () => {
  it("re-seeding preserves recording_attested and SRS state, refreshing only freq_rank/cefr", () => {
    const db = freshDb();

    // A lemma the asset seeds. Simulate E-28 having marked it recording-attested
    // with a derived SRS cache, and scramble its reference columns.
    const id = "lemma:casa#NOUN";
    const before = db.prepare("SELECT freq_rank, cefr FROM knowledge_items WHERE id = ?").get(id) as {
      freq_rank: number;
      cefr: string;
    };
    expect(before.freq_rank).toBeGreaterThan(0);
    db.prepare(
      `UPDATE knowledge_items
         SET recording_attested = 1, srs_stability = 12.5, srs_difficulty = 4.2,
             status = 'known', freq_rank = 999999, cefr = 'ZZ'
       WHERE id = ?`,
    ).run(id);

    // A produced lemma E-28 minted that is NOT in the frequency cut (via the real
    // gate). Its evidence and derived mark must be left entirely alone by the seed.
    const off = ensureLemmaItem(db, "casa", "NOUN"); // already exists; harmless
    expect(off).toBe(id);

    const n = seedFrequencyLexicon(db);
    expect(n).toBeGreaterThanOrEqual(15_000);

    const after = db.prepare(
      "SELECT freq_rank, cefr, recording_attested, srs_stability, srs_difficulty, status FROM knowledge_items WHERE id = ?",
    ).get(id) as { freq_rank: number; cefr: string; recording_attested: number; srs_stability: number; srs_difficulty: number; status: string };

    // Reference columns are restored to the asset's values …
    expect(after.freq_rank).toBe(before.freq_rank);
    expect(after.cefr).toBe(before.cefr);
    // … while every derived / evidence-driven column is untouched.
    expect(after.recording_attested).toBe(1);
    expect(after.srs_stability).toBe(12.5);
    expect(after.srs_difficulty).toBe(4.2);
    expect(after.status).toBe("known");
  });

  it("preserves an evidence-marked produced lemma's mark and the append-only log", () => {
    const db = freshDb();
    // A lemma minted through the real gate and marked by a spontaneous, audio-derived
    // positive finding (exactly what E-28's produced-lemma path writes).
    const target = db
      .prepare("SELECT lemma, pos FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank DESC LIMIT 1")
      .get() as { lemma: string; pos: string };
    const id = ensureLemmaItem(db, target.lemma, target.pos as never);
    recordEvidence(db, { itemId: id, source: "finding", polarity: 1, mode: "spontaneous", audioDerived: true });
    const evCountBefore = (db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n;

    seedFrequencyLexicon(db);

    // Evidence is append-only and untouched; the row's derived mark survives.
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(evCountBefore);
    const row = db.prepare("SELECT recording_attested FROM knowledge_items WHERE id = ?").get(id) as { recording_attested: number };
    expect(row.recording_attested).toBe(1);
  });
});
