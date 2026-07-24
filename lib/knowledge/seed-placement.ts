import type { Db } from "../db";
import { recordEvidence } from "./evidence";
import { itemExists } from "./items";
import { bandIndex, type Band } from "../placement/scoring";

// Seeding the knowledge model from a placement result (E-35, D-19). Placement is a
// yes/no RECOGNITION test, so everything it writes is `mode:'recognition'` positive
// evidence — the weakest signal (D-19, weight 0.3). Recognition can move an item to
// `introduced` but NEVER to `known` (`derive.ts` forbids it: recognition rows are
// excluded from every clause of the `known` gate). So this seeding is honest: it
// records "the learner recognized this / has plausibly met this", not "the learner
// has produced this".
//
// TWO targets, both writing recognition evidence:
//  1. VOCAB — the specific real words the learner marked "known" (never a whole
//     band: only genuinely-recognized words, D-19). They become `introduced`, so the
//     daily composer stops offering them as brand-new vocabulary.
//  2. GRAMMAR — every syllabus rule BELOW the placed level. There is no per-rule
//     recognition signal (the check is vocabulary), so the level is the only
//     evidence; marking sub-level rules `introduced` (a) stops the composer handing
//     an A1 alphabet lesson to an intermediate learner, and (b) — via the composer's
//     teaching-eligibility (`compose.ts` TEACH_ELIGIBLE_PREREQ, which counts
//     `introduced` prereqs as met, E-35 review Finding #1) — UNLOCKS the rules AT the
//     learner's level, so a placed learner is offered grammar at their edge rather
//     than nothing (the RETRO-003 fix). Rules at the level itself are left `unseen`
//     so they are the new grammar offered. This is teaching-eligibility only; the
//     `known` mastery gate in derive.ts still excludes recognition (D-19, untouched).
//
// Re-runnable: re-placement is idempotent per item (a target that already carries a
// placement recognition row is skipped), so the append-only log does not grow on
// repeated placements with the same answers.

/** True once this item already carries a placement-sourced recognition row — so a
 *  re-run does not append a duplicate. */
function alreadyPlacementSeeded(db: Db, itemId: string): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM evidence WHERE item_id = ? AND source = 'placement' AND mode = 'recognition' LIMIT 1",
    )
    .get(itemId);
}

/** The rule items whose CEFR band is strictly BELOW `level` — the sub-level grammar
 *  to mark `introduced`. Rules AT the level are deliberately left `unseen` so they
 *  become the new grammar the composer offers at the learner's edge. Bands off the
 *  A1…C2 scale are left alone. */
function rulesBelowLevel(db: Db, level: Band): string[] {
  const max = bandIndex(level);
  const rows = db
    .prepare("SELECT id, cefr FROM knowledge_items WHERE kind = 'rule' AND cefr IS NOT NULL")
    .all() as { id: string; cefr: string }[];
  return rows.filter((r) => bandIndex(r.cefr as Band) >= 0 && bandIndex(r.cefr as Band) < max).map((r) => r.id);
}

export interface SeedPlacementInput {
  /** The placed level; null means below A1 (a true beginner) — no grammar is seeded. */
  level: Band | null;
  /** Lemma item ids the learner genuinely recognized (marked "known"). */
  recognizedItemIds: string[];
}

export interface SeedPlacementResult {
  seededWords: number;
  seededRules: number;
}

/**
 * Write recognition-only evidence for a placement result. All rows are
 * `source:'placement'`, `mode:'recognition'`, `polarity:1`, NOT audio-derived. No
 * row can reach `known` (D-19). One transaction is not required — each `recordEvidence`
 * is atomic and independent — but skipping already-seeded items keeps re-placement
 * from bloating the append-only log. Returns how many words and rules were seeded.
 */
export function seedPlacement(db: Db, input: SeedPlacementInput): SeedPlacementResult {
  let seededWords = 0;
  for (const itemId of new Set(input.recognizedItemIds)) {
    if (!itemExists(db, itemId)) continue; // a tampered/unknown id is ignored, never invented
    if (alreadyPlacementSeeded(db, itemId)) continue;
    recordEvidence(db, {
      itemId,
      source: "placement",
      polarity: 1,
      mode: "recognition",
      audioDerived: false,
    });
    seededWords += 1;
  }

  let seededRules = 0;
  if (input.level !== null) {
    for (const ruleId of rulesBelowLevel(db, input.level)) {
      if (alreadyPlacementSeeded(db, ruleId)) continue;
      recordEvidence(db, {
        itemId: ruleId,
        source: "placement",
        polarity: 1,
        mode: "recognition",
        audioDerived: false,
      });
      seededRules += 1;
    }
  }

  return { seededWords, seededRules };
}
