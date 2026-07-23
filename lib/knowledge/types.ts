import type { Pos } from "../lexicon/pos";

// Shared types and constants for the knowledge core (E-25, D-19). Client-safe:
// pure data and the mode/weight constants, no I/O. The DB glue lives in the sibling
// modules (items / evidence / derive).

export type ItemKind = "lemma" | "rule" | "phone";
export type EvidenceSource = "finding" | "exercise" | "tutor" | "placement";
/** Production strength of an observation: unprompted ≫ prompted ≫ merely recognised. */
export type EvidenceMode = "spontaneous" | "cued" | "recognition";
export type KnowledgeStatus = "unseen" | "introduced" | "learning" | "known" | "lapsed";

/** Mode weights (D-19): spontaneous 1.0 ≫ cued 0.6 ≫ recognition 0.3. */
export const MODE_WEIGHT: Record<EvidenceMode, number> = {
  spontaneous: 1.0,
  cued: 0.6,
  recognition: 0.3,
};

/** Confidence discount applied to a mode weight when the evidence is audio-derived
 *  (a recording is noisier than a typed exercise) — D-19. */
export const AUDIO_DISCOUNT = 0.7;

/** The weight an observation carries: its mode weight, discounted if audio-derived. */
export function evidenceWeight(mode: EvidenceMode, audioDerived: boolean): number {
  return MODE_WEIGHT[mode] * (audioDerived ? AUDIO_DISCOUNT : 1);
}

/** Recover whether a stored evidence row was audio-derived from its (mode, weight):
 *  the ×0.7 discount is uniquely detectable because the discounted weights
 *  (0.7 / 0.42 / 0.21) never collide with the undiscounted ones (1.0 / 0.6 / 0.3).
 *  So the D-19 audio flag needs no column of its own (the spike-2 schema has none). */
export function isAudioDerived(mode: EvidenceMode, weight: number): boolean {
  return weight < MODE_WEIGHT[mode] - 1e-9;
}

export interface KnowledgeItem {
  id: string;
  kind: ItemKind;
  lemma: string | null;
  pos: Pos | null;
  senseKey: string | null;
  freqRank: number | null;
  cefr: string | null;
  prereqs: string[] | null;
  srsStability: number | null;
  srsDifficulty: number | null;
  srsLastEventAt: string | null;
  status: KnowledgeStatus;
}

/** A validated observation ready to append to the log. */
export interface EvidenceInput {
  itemId: string;
  source: EvidenceSource;
  sourceRef?: string | null;
  polarity: 0 | 1;
  mode: EvidenceMode;
  audioDerived: boolean;
  sessionId?: string | null;
}

export interface Evidence {
  id: string;
  itemId: string;
  source: EvidenceSource;
  sourceRef: string | null;
  polarity: 0 | 1;
  mode: EvidenceMode;
  weight: number;
  sessionId: string | null;
  createdAt: string;
}

export type { Pos } from "../lexicon/pos";
