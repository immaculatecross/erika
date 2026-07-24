import { loadFrequencyLexicon, type LexiconRecord } from "../lexicon/frequency-lexicon";
import { lemmaItemId } from "../knowledge/items";
import { BANDS, type Band } from "./scoring";
import { PSEUDOWORDS } from "./pseudowords";

// Builds one placement vocabulary check (E-35): real Italian words sampled per
// frequency band from the committed lexicon (A1→C2) interleaved with the original
// pseudowords. Server-only (reads the lexicon asset). The returned items carry
// everything the pure scorer needs — a real word's band and its lemma item id (for
// seeding), a pseudoword's nothing — so the API layer stays a thin echo: the client
// presents the words, collects yes/no, and posts the annotated answers back.
//
// Sampling is DETERMINISTIC given a seed (tests pin it) and spreads its picks across
// each band's rank range rather than clustering at one end, so a band is represented
// by a fair span of its frequency stratum. Pseudowords are woven in at roughly a
// fixed proportion so the false-alarm estimate stays stable.

export interface PlacementCheckItem {
  /** Stable per-item token the client echoes back with its answer. */
  id: string;
  /** The word shown to the learner. */
  word: string;
  kind: "real" | "pseudo";
  /** Real words only: the band sampled from and the lemma knowledge-item id. */
  band?: Band;
  itemId?: string;
}

export interface BuildCheckOptions {
  /** Real words per band (default 8). */
  perBand?: number;
  /** Pseudowords in the whole check (default 16). */
  pseudoCount?: number;
  /** Deterministic seed (tests). Omit for a fresh random check. */
  seed?: number;
}

/** A tiny deterministic PRNG (mulberry32) so a seeded check is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Group the lexicon by band once. */
function byBand(records: LexiconRecord[]): Map<Band, LexiconRecord[]> {
  const map = new Map<Band, LexiconRecord[]>();
  for (const b of BANDS) map.set(b, []);
  for (const r of records) {
    const bucket = map.get(r.band as Band);
    if (bucket) bucket.push(r);
  }
  // Each band ascending by rank so an even-stride pick spreads across the stratum.
  for (const b of BANDS) map.get(b)!.sort((x, y) => x.freqRank - y.freqRank);
  return map;
}

/** Pick `n` records spread evenly across `pool` (already rank-sorted), jittered by
 *  the RNG so repeated seeds differ but one seed is reproducible. */
function spreadPick(pool: LexiconRecord[], n: number, rng: () => number): LexiconRecord[] {
  if (pool.length <= n) return pool.slice();
  const out: LexiconRecord[] = [];
  const stride = pool.length / n;
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(i * stride + rng() * stride);
    if (idx >= pool.length) idx = pool.length - 1;
    while (seen.has(idx)) idx = (idx + 1) % pool.length;
    seen.add(idx);
    out.push(pool[idx]);
  }
  return out;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a shuffled placement check: `perBand` real words per band + `pseudoCount`
 * pseudowords. Real words become items keyed to their lemma id so a "yes" can be
 * seeded as recognition evidence; pseudowords are the response-style control.
 */
export function buildPlacementCheck(opts: BuildCheckOptions = {}): PlacementCheckItem[] {
  const perBand = opts.perBand ?? 8;
  const pseudoCount = opts.pseudoCount ?? 16;
  const rng = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));

  const grouped = byBand(loadFrequencyLexicon());
  const items: PlacementCheckItem[] = [];
  for (const band of BANDS) {
    const picks = spreadPick(grouped.get(band) ?? [], perBand, rng);
    for (const r of picks) {
      items.push({
        id: `r:${r.lemma}#${r.pos}`,
        word: r.lemma,
        kind: "real",
        band,
        itemId: lemmaItemId(r.lemma, r.pos),
      });
    }
  }

  const pseudos = shuffle(PSEUDOWORDS.slice(), rng).slice(0, Math.min(pseudoCount, PSEUDOWORDS.length));
  for (const w of pseudos) items.push({ id: `p:${w}`, word: w, kind: "pseudo" });

  return shuffle(items, rng);
}
