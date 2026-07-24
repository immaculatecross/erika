import fs from "node:fs";
import zlib from "node:zlib";
import { lexiconAssetPath } from "./asset-path";
import { isPos, type Pos } from "./pos";

// The morph-it canonical-lemma validator (E-25). morph-it (Baroni & Zanchetta,
// Univ. Bologna/Trento; CC BY-SA 2.0 — see NOTICE.md) attests which (lemma, POS)
// pairs are real Italian; this module loads the committed, reduced asset once and
// answers "does morph-it attest this (lemma, POS)?". It is the gate that keeps any
// fabricated or misspelled lemma out of the knowledge model: no `knowledge_items`
// lemma row and no `evidence` row can be minted on a (lemma, POS) it rejects
// (enforced in lib/knowledge/items.ts). Server-only (reads a file); works in tests
// and CI with no network — the asset is in the repo.
//
// This is a deterministic lookup of real data, not a tuned threshold: the reduced
// asset is the file's own distinct (lemma, POS) set, so the file is the oracle
// (D-13). The lookup is case-sensitive on the lemma (morph-it lemmas are lower-case
// citation forms; a caller lower-cases if it must) and exact on the POS.

/** Repo-relative path to the committed gzipped asset (one `lemma\tPOS` per line).
 *  The load resolves this against the project root (see `assetFile`). */
export const ASSET_PATH = "lib/lexicon/morphit-lemmas.tsv.gz";

let cache: Set<string> | null = null;

function key(lemma: string, pos: string): string {
  return `${lemma}\t${pos}`;
}

/**
 * Absolute path to the committed asset, resolved via `lexiconAssetPath` — beside
 * this module when possible (cwd-independent, the E-28 intent), else against the
 * project root. It does NOT use `new URL(..., import.meta.url)`: under Next's
 * webpack server bundle that pattern is rewritten to a browser asset URL, not a
 * filesystem path (see `asset-path.ts`) — the same defect that 500'd the v17 seed.
 * `attestsLemma` runs on the deep-analysis/evidence path, so it would have 500'd
 * there under the bundle too.
 */
function assetFile(): string {
  return lexiconAssetPath(ASSET_PATH);
}

/** Load and memoise the attested (lemma, POS) set from the committed asset. Built
 *  at first use so importing this module is cheap; the ~38k-entry Set is small. */
function attestedSet(): Set<string> {
  if (cache) return cache;
  const raw = zlib.gunzipSync(fs.readFileSync(assetFile())).toString("utf8");
  const set = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    // A stray malformed line in the asset is skipped, never fatal (D-13).
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    set.add(line);
  }
  cache = set;
  return set;
}

/** True iff morph-it attests `(lemma, pos)` — the canonical-lemma gate. A POS
 *  outside the scheme (isPos false) is never attested. */
export function attestsLemma(lemma: string, pos: string): boolean {
  if (!lemma || !isPos(pos)) return false;
  return attestedSet().has(key(lemma, pos));
}

/** How many distinct (lemma, POS) pairs are attested — for diagnostics/tests. */
export function attestedCount(): number {
  return attestedSet().size;
}

/** Reset the memoised set (tests only). */
export function _resetAttestedCache(): void {
  cache = null;
}

export type { Pos };
