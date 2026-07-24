import type { Db } from "./db";
import { loadCanon, cefrRank, type CanonPassage } from "./canon";
import { CEFR_LEVELS, type CefrLevel } from "./syllabus/types";

// The reading/listening format's edge match (E-33, WO criterion 3). A passage from
// the public-domain canon is chosen to sit at the LEARNER'S EDGE — the CEFR band of
// what they are already working through — so a beginner gets an easier passage than
// an advanced learner. Selection is a PURE function over the passage list and the
// edge band (unit-tested with hand-built inputs); the DB glue derives the edge band
// from the knowledge state and makes ZERO model calls.
//
// Deriving new-item candidates from the passage's unknown lemmas is explicitly
// OPTIONAL in the WO ("may ... optional; do not double-charge") and is deferred — it
// needs the morph-it lemmatizer over free Italian text, and the composer (E-31) is
// the sanctioned new-item path. This format demonstrates leveled reading + listen.

/**
 * Pick the passage best matched to `edgeBand`: the HIGHEST band that does not exceed
 * the learner's edge (reading at your level, never above it). If every passage is
 * above the edge (an edge below the easiest passage), fall back to the easiest so the
 * surface is never empty. Pure and deterministic; ties broken by id for stability.
 */
export function selectPassage(passages: CanonPassage[], edgeBand: CefrLevel): CanonPassage | null {
  if (passages.length === 0) return null;
  const edge = cefrRank(edgeBand);
  const atOrBelow = passages.filter((p) => cefrRank(p.cefr) <= edge);
  const pool = atOrBelow.length > 0 ? atOrBelow : passages;
  // Highest band within the pool (closest to the edge); easiest overall in fallback.
  return pool.reduce((best, p) => {
    const better = atOrBelow.length > 0 ? cefrRank(p.cefr) > cefrRank(best.cefr) : cefrRank(p.cefr) < cefrRank(best.cefr);
    if (better) return p;
    if (cefrRank(p.cefr) === cefrRank(best.cefr) && p.id < best.id) return p;
    return best;
  });
}

/**
 * The learner's reading edge band, derived from the knowledge state: the HIGHEST
 * CEFR band among items they are actually engaging (status learning / known /
 * lapsed — real production/drill evidence, not mere recognition). A learner with no
 * such evidence sits at A1 (the beginning). Rules carry a real CEFR; lemmas carry
 * the rank-derived band (v17). ZERO model calls.
 */
export function learnerReadingEdge(db: Db): CefrLevel {
  const rows = db
    .prepare(
      `SELECT DISTINCT cefr FROM knowledge_items
        WHERE cefr IS NOT NULL AND status IN ('learning','known','lapsed')`,
    )
    .all() as { cefr: string }[];
  let best = 0;
  for (const r of rows) {
    const idx = (CEFR_LEVELS as readonly string[]).indexOf(r.cefr);
    if (idx > best) best = idx;
  }
  return CEFR_LEVELS[best];
}

export interface ReadingView {
  /** The learner's derived edge band. */
  edge: CefrLevel;
  /** The passage chosen for the edge, or null if the canon is somehow empty. */
  passage: CanonPassage | null;
}

/** Build the reading surface's view: the edge band and the matched canon passage. */
export function buildReadingView(db: Db): ReadingView {
  const edge = learnerReadingEdge(db);
  const passage = selectPassage(loadCanon().passages, edge);
  return { edge, passage };
}
