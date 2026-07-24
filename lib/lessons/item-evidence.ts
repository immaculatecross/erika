import type { Db } from "../db";
import { getItem, itemExists } from "../knowledge/items";
import { recordEvidence } from "../knowledge/evidence";
import type { Evidence, KnowledgeStatus } from "../knowledge/types";

// E-32 criterion 4: completing a graded exercise feeds the knowledge core. A
// resolved exercise writes ONE evidence row through the E-25 append-only door
// (recordEvidence — the same validated-id gate the whole knowledge model shares),
// then the item's derived state rebuilds from the log. The row is honestly typed:
//
//   source  = "exercise"      (a typed drill, D-19's exercise source)
//   mode    = "cued"          (the learner was prompted and produced the form — not
//                              spontaneous, not recognition-only; D-19 weight 0.6)
//   audio   = false           (a typed exercise is not noisy recording audio)
//   polarity= correct ? 1 : 0 (right → positive, wrong → negative)
//
// Mode is set HONESTLY (WO): a cued positive can corroborate toward `learning`/
// `known` but never supplies the spontaneous witness D-19's `known` gate demands, so
// practice cannot fake mastery. Evidence stays append-only; nothing here mutates a
// prior row. `recordEvidence` refuses an unvalidated lemma id and an unknown item,
// so a lemma exercise can only write on a morph-it-attested id and a rule exercise
// only on a real `rule:` item — the WO's "morph-it-validated / valid rule" ID.

/** Thrown when an exercise result targets an item that does not exist. */
export class NoSuchItemError extends Error {
  constructor(itemId: string) {
    super(`No knowledge item ${itemId} to record an exercise result on.`);
    this.name = "NoSuchItemError";
  }
}

export interface ExerciseResult {
  /** The completed exercise's evidence row. */
  evidence: Evidence;
  /** The item's derived status after the write (rebuilt from the whole log). */
  status: KnowledgeStatus;
}

/**
 * Record one graded exercise as cued evidence on its knowledge item and return the
 * row plus the item's rebuilt status. A wrong answer writes a negative-polarity row
 * (still one row — a mistake is production evidence too, weighted by FSRS). The item
 * must already exist (the composer selected it from `knowledge_items`); an unknown
 * item is a truthful error, never a silently dropped write.
 */
export function recordExerciseEvidence(
  db: Db,
  input: { itemId: string; correct: boolean; sessionId?: string | null },
): ExerciseResult {
  if (!itemExists(db, input.itemId)) throw new NoSuchItemError(input.itemId);
  const evidence = recordEvidence(db, {
    itemId: input.itemId,
    source: "exercise",
    polarity: input.correct ? 1 : 0,
    mode: "cued",
    audioDerived: false,
    sessionId: input.sessionId ?? null,
  });
  const status = getItem(db, input.itemId)!.status;
  return { evidence, status };
}
