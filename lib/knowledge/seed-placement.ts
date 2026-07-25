import type { Db } from "../db";
import { recordEvidence } from "./evidence";
import { rebuildItem } from "./derive";
import { itemExists } from "./items";
import { placementSeedRef, recordPlacementRun } from "./placement-runs";
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
// RE-PLACEMENT SUPERSEDES (RETRO-004 §DE-2, v27). This used to be "idempotent per item":
// a target that already carried ANY placement recognition row was skipped, so the log
// did not grow on a repeat. That was the wrong invariant — it made a careless placement
// permanent. A run placed at C2 seeded 238 rules, the plan served C2 grammar, and
// re-taking the check honestly as A1 returned `level: "A1"` while the plan went on
// serving the same C2 rules, with no way out short of deleting the database.
//
// So each placement now records a RUN first, tags its rows with that run
// (`source_ref = 'placement:<run id>'`), and re-derives every item the PREVIOUS runs had
// touched. Because the evidence read path shows only the latest run's placement rows
// (derive.ts `itemEvidence`), items the new placement does not claim fall back to
// `unseen` and leave the daily plan. The dedup is now per-run, which is all it ever
// needed to be: within one placement each target is written once.
//
// The append-only log DOES grow across placements, and that is correct — every
// observation ever made is retained and auditable. Nothing is updated or deleted, so the
// v14 triggers are never touched.

/** True once this item already carries a recognition row from THIS run — so one run
 *  cannot write a target twice. Deliberately scoped to the run: a row from an earlier,
 *  now-superseded placement must NOT suppress the current one's seeding. */
function alreadySeededInRun(db: Db, itemId: string, ref: string): boolean {
  return !!db
    .prepare(
      "SELECT 1 FROM evidence WHERE item_id = ? AND source = 'placement' AND source_ref = ? LIMIT 1",
    )
    .get(itemId, ref);
}

/** Every item any placement has ever seeded — the set whose derived state may need
 *  rebuilding once a new run supersedes the old ones. */
function everPlacementSeeded(db: Db): string[] {
  return (
    db
      .prepare("SELECT DISTINCT item_id FROM evidence WHERE source = 'placement'")
      .all() as { item_id: string }[]
  ).map((r) => r.item_id);
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
  /** The placed level; null means below A1 (or unplaceable) — no grammar is seeded. */
  level: Band | null;
  /** Lemma item ids the learner genuinely recognized (marked "known"). */
  recognizedItemIds: string[];
  /** Whether the scorer trusted this estimate — recorded on the run for provenance. */
  calibrated?: boolean;
  /** The run's measured false-alarm rate — recorded on the run for provenance. */
  falseAlarmRate?: number | null;
}

export interface SeedPlacementResult {
  /** The run this seeding belongs to. A later run supersedes it. */
  runId: string;
  seededWords: number;
  seededRules: number;
  /** Items a PREVIOUS placement had seeded that this one does not — re-derived, so they
   *  leave the daily plan. Zero on a first placement. */
  supersededItems: number;
}

/**
 * Write recognition-only evidence for a placement result. All rows are
 * `source:'placement'`, `mode:'recognition'`, `polarity:1`, NOT audio-derived. No
 * row can reach `known` (D-19).
 *
 * The run is recorded FIRST: that insert is what makes earlier runs superseded, so
 * every `recordEvidence` below (each of which re-derives its item) already sees the new
 * world. Items the previous runs claimed and this one does not are re-derived explicitly
 * at the end — that is the step that actually re-places the learner.
 */
export function seedPlacement(db: Db, input: SeedPlacementInput): SeedPlacementResult {
  const previouslySeeded = everPlacementSeeded(db);
  const runId = recordPlacementRun(db, {
    level: input.level,
    calibrated: input.calibrated ?? false,
    falseAlarmRate: input.falseAlarmRate ?? null,
  });
  const ref = placementSeedRef(runId);
  const seededNow = new Set<string>();

  let seededWords = 0;
  for (const itemId of new Set(input.recognizedItemIds)) {
    if (!itemExists(db, itemId)) continue; // a tampered/unknown id is ignored, never invented
    if (alreadySeededInRun(db, itemId, ref)) continue;
    recordEvidence(db, {
      itemId,
      source: "placement",
      sourceRef: ref,
      polarity: 1,
      mode: "recognition",
      audioDerived: false,
    });
    seededNow.add(itemId);
    seededWords += 1;
  }

  let seededRules = 0;
  if (input.level !== null) {
    for (const ruleId of rulesBelowLevel(db, input.level)) {
      if (alreadySeededInRun(db, ruleId, ref)) continue;
      recordEvidence(db, {
        itemId: ruleId,
        source: "placement",
        sourceRef: ref,
        polarity: 1,
        mode: "recognition",
        audioDerived: false,
      });
      seededNow.add(ruleId);
      seededRules += 1;
    }
  }

  // The retraction. These items' cached status still reflects a placement that is no
  // longer current; re-deriving from the (now filtered) log is what drops them back to
  // `unseen` and out of the daily plan. `rebuildItem` reads through
  // `VISIBLE_PLACEMENT_EVIDENCE`, so this needs no knowledge of what changed.
  let supersededItems = 0;
  for (const itemId of previouslySeeded) {
    if (seededNow.has(itemId)) continue;
    rebuildItem(db, itemId);
    supersededItems += 1;
  }

  return { runId, seededWords, seededRules, supersededItems };
}
