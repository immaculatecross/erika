import type { Db } from "./db";
import { getIncludedFinding, listIncludedFindings } from "./findings-model";

// The listen-and-shadow format's read-model (E-33, WO criterion 2, D-18). A shadow
// drill renders a CORRECT target phrase, plays it, and lets the learner record a
// shadow take through the normal capture→ingest path. The target is ALWAYS the
// finding's `correction` — the correct recast — NEVER the learner's `quote` (their
// error): D-18 is absolute that an erroneous utterance is never a practice stimulus.
// This module is the one place that resolves a finding to its shadow target, so the
// "never the error" invariant lives in exactly one testable spot. No model calls, no
// scoring here — scoring is Azure/E-37 (D-21); E-33 only renders + records the take.

/** One shadow drill: a correct target phrase to hear and shadow, plus context. */
export interface ShadowDrill {
  findingId: string;
  /** The CORRECT phrase to render and shadow — the finding's correction (D-18). */
  target: string;
  /** Why it is the correct form — the finding's explanation, for display only. */
  explanation: string;
  /** The finding's category, for a quiet label. */
  category: string;
}

/** The shadow drill for one finding, or null if the finding is not an included
 *  finding (E-17 scope). The target is the correction — asserted in tests to never
 *  equal the finding's quote (the error). */
export function shadowTarget(db: Db, findingId: string): ShadowDrill | null {
  const f = getIncludedFinding(db, findingId);
  if (!f) return null;
  return { findingId: f.id, target: f.correction, explanation: f.explanation, category: f.category };
}

/** Every included finding as a shadow drill, newest first — the shadow list. Each
 *  target is a correct recast, never an error form (D-18). */
export function listShadowDrills(db: Db, limit = 50): ShadowDrill[] {
  return listIncludedFindings(db)
    .slice(0, limit)
    .map((f) => ({ findingId: f.id, target: f.correction, explanation: f.explanation, category: f.category }));
}
