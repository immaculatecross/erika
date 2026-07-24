import fs from "node:fs";
import zlib from "node:zlib";
import { lexiconAssetPath } from "./asset-path";
import { isPos, type Pos } from "./pos";

// The frequency lexicon (E-26a, D-19). A comprehensive, license-clean Italian
// lemma inventory: FrequencyWords' OpenSubtitles-2018 wordform frequencies
// (hermitdave, CC BY-SA — see NOTICE.md) lemmatized through the Morph-it! form→
// lemma+POS map (CC BY-SA 2.0) and summed to lemma frequencies, each survivor
// gated by the E-25 morph-it validator (`attestsLemma`) so nothing fabricated,
// misspelled, or foreign enters the model. This module loads the committed,
// reduced asset once and exposes its rows to the v17 seed. Server-only (reads a
// file); works in tests and CI with no network — the asset is in the repo.
//
// The asset is the file's own oracle (D-13): `scripts/build-lexicon.ts` writes
// exactly the `(lemma, POS, freq_rank, band)` rows the seed reads back. Ranks are
// dense and unique (1 = most frequent). The `band` is a COARSE band DERIVED FROM
// FREQUENCY RANK (see `rankToBand`), NOT a measured CEFR level and NOT from any
// CC BY-NC source (Kelly/itWaC/spaCy stay out of the shipped data path, D-19).

/** Repo-relative path to the committed gzipped asset (one
 *  `lemma\tPOS\tfreq_rank\tband` per line, after a `#`-prefixed header block).
 *  The load resolves this against the project root (see `assetFile`). */
export const ASSET_PATH = "lib/lexicon/frequency-lexicon.tsv.gz";

/** One lemma row of the frequency lexicon. */
export interface LexiconRecord {
  lemma: string;
  pos: Pos;
  freqRank: number;
  /** Coarse frequency band (A1…C2), derived from `freqRank` — never a measured CEFR. */
  band: string;
}

/**
 * Map a dense frequency rank to a coarse band label. This is a purely
 * FREQUENCY-DERIVED ordinal proxy — the license-clean substitute for CEFR labels
 * (D-19: Kelly's real CEFR bands are CC BY-NC, out of the data path). The letters
 * are a familiar ordinal scale, not a claim about a learner's measured level: the
 * most frequent ~1k lemmas are the A1 core, the long colto/literary tail is C2.
 */
export function rankToBand(rank: number): string {
  if (rank <= 1000) return "A1";
  if (rank <= 2000) return "A2";
  if (rank <= 4000) return "B1";
  if (rank <= 8000) return "B2";
  if (rank <= 16000) return "C1";
  return "C2";
}

/**
 * Absolute path to the committed asset, resolved via `lexiconAssetPath` — beside
 * this module when possible (cwd-independent, the E-28 intent), else against the
 * project root. It does NOT use `new URL(..., import.meta.url)`: under Next's
 * webpack server bundle that pattern is rewritten to a browser asset URL, not a
 * filesystem path, which 500'd the v17 seed on first migration (see `asset-path.ts`).
 */
function assetFile(): string {
  return lexiconAssetPath(ASSET_PATH);
}

let cache: LexiconRecord[] | null = null;

/**
 * Load and memoise the frequency lexicon from the committed asset. Header lines
 * (blank or `#`-prefixed) are skipped; a stray malformed data line is skipped,
 * never fatal (D-13). Rows carrying a POS outside the scheme are dropped defensively.
 */
export function loadFrequencyLexicon(): LexiconRecord[] {
  if (cache) return cache;
  const raw = zlib.gunzipSync(fs.readFileSync(assetFile())).toString("utf8");
  const records: LexiconRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const [lemma, pos, rankStr, band] = cols;
    const freqRank = Number(rankStr);
    if (!lemma || !isPos(pos) || !Number.isInteger(freqRank) || freqRank < 1) continue;
    records.push({ lemma, pos, freqRank, band: band || rankToBand(freqRank) });
  }
  cache = records;
  return records;
}

/** How many lemma rows the asset carries — for diagnostics/tests. */
export function frequencyLexiconCount(): number {
  return loadFrequencyLexicon().length;
}

/** Reset the memoised records (tests only). */
export function _resetFrequencyLexiconCache(): void {
  cache = null;
}
