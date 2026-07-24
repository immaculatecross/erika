import type { Db } from "../db";
import { recordEvidence } from "../knowledge/evidence";
import { ensureLemmaItem, itemExists, parseItemId, UnvalidatedLemmaError } from "../knowledge/items";
import type { Evidence, EvidenceMode } from "../knowledge/types";

// The `log_evidence` tool → evidence bridge (E-34, D-19). During a tutor call the
// Realtime model calls `log_evidence` to record what the learner produced — errors
// AND successes — and each call lands one row in the append-only `evidence` log
// through the ONE E-25 door (`recordEvidence`), on a VALIDATED id. This module is
// the whole validation + mapping layer between the model's free-form tool call and
// that door.
//
// Never-waivable (WO criterion 3): an INVALID id is REJECTED, never minted. A lemma
// id must be morph-it-attested (the D-19 canonical-lemma gate — `ensureLemmaItem`
// mints it iff attested, otherwise throws); a rule id must already exist as a seeded
// syllabus item (the tutor cannot invent a grammar rule). Evidence is append-only
// and an error is recorded, never turned into a drill (D-18 lives in the persona /
// the composer, not here — here we simply log what happened, both polarities).
//
// The tutor's judgment is a deliberate structured call, not a re-listen of audio, so
// evidence is source `tutor`, NOT audio-derived (no ×0.7 discount); the mode weight
// (spontaneous 1.0 / cued 0.6) still applies (D-19).

/** The mode a tutor may honestly report — production, prompted or not (D-19). A
 *  `recognition`-mode judgment does not apply to a spoken tutor turn and is rejected. */
export const TUTOR_EVIDENCE_MODES = ["spontaneous", "cued"] as const;
export type TutorEvidenceMode = (typeof TUTOR_EVIDENCE_MODES)[number];

/** Raised when a `log_evidence` tool call is malformed or names an id we won't mint. */
export class InvalidEvidenceCallError extends Error {}

/** The structured shape a `log_evidence` tool call resolves to (after arg parsing). */
export interface LogEvidenceCall {
  /** `rule:<key>` (must already exist) or `lemma:<lemma>#<POS>` (must be attested). */
  itemId: string;
  /** 1 = the learner produced it correctly; 0 = an error. */
  polarity: 0 | 1;
  /** How it was produced (D-19 mode weight). */
  mode: TutorEvidenceMode;
  /** The tutor recording's session id, once the take has landed — for provenance. */
  sessionId?: string | null;
}

function isMode(x: unknown): x is TutorEvidenceMode {
  return typeof x === "string" && (TUTOR_EVIDENCE_MODES as readonly string[]).includes(x);
}

/**
 * Parse and validate one raw `log_evidence` tool-call argument object into a typed
 * call. Throws `InvalidEvidenceCallError` on any malformed field. Does NOT touch the
 * DB — id EXISTENCE/attestation is checked in `logTutorEvidence` so this stays pure.
 */
export function parseLogEvidenceArgs(raw: unknown): LogEvidenceCall {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidEvidenceCallError("log_evidence arguments must be an object.");
  }
  const o = raw as Record<string, unknown>;
  const itemId = o.itemId ?? o.item_id;
  if (typeof itemId !== "string" || itemId.trim() === "") {
    throw new InvalidEvidenceCallError("log_evidence requires a non-empty itemId.");
  }
  const kind = parseItemId(itemId).kind;
  if (kind !== "lemma" && kind !== "rule") {
    throw new InvalidEvidenceCallError(`log_evidence only accepts lemma or rule ids, got "${itemId}".`);
  }
  const polarityRaw = o.polarity ?? o.correct;
  const polarity =
    polarityRaw === 1 || polarityRaw === true || polarityRaw === "correct" || polarityRaw === "1"
      ? 1
      : polarityRaw === 0 || polarityRaw === false || polarityRaw === "incorrect" || polarityRaw === "0"
        ? 0
        : null;
  if (polarity === null) {
    throw new InvalidEvidenceCallError("log_evidence requires polarity (correct / incorrect).");
  }
  if (!isMode(o.mode)) {
    throw new InvalidEvidenceCallError(`log_evidence mode must be one of: ${TUTOR_EVIDENCE_MODES.join(", ")}.`);
  }
  const sessionId = typeof o.sessionId === "string" ? o.sessionId : typeof o.session_id === "string" ? o.session_id : null;
  return { itemId: itemId.trim(), polarity, mode: o.mode, sessionId };
}

/**
 * Write one tutor `log_evidence` call to the append-only evidence log, on a
 * validated id. For a lemma, `ensureLemmaItem` enforces the morph-it gate (throwing
 * `InvalidEvidenceCallError` on an unattested lemma, never minting it); for a rule,
 * the id must already exist as a seeded syllabus item, else it is rejected. On
 * success returns the appended `Evidence`; the item's derived cache rebuilds inside
 * `recordEvidence` (E-25).
 */
export function logTutorEvidence(db: Db, call: LogEvidenceCall): Evidence {
  const parsed = parseItemId(call.itemId);
  if (parsed.kind === "lemma") {
    try {
      if (!parsed.lemma || !parsed.pos) throw new InvalidEvidenceCallError(`Malformed lemma id "${call.itemId}".`);
      ensureLemmaItem(db, parsed.lemma, parsed.pos, parsed.senseKey);
    } catch (err) {
      if (err instanceof UnvalidatedLemmaError) {
        throw new InvalidEvidenceCallError(`Rejected unattested lemma id "${call.itemId}": ${err.message}`);
      }
      throw err;
    }
  } else if (parsed.kind === "rule") {
    if (!itemExists(db, call.itemId)) {
      throw new InvalidEvidenceCallError(`Rejected unknown rule id "${call.itemId}" (not a seeded syllabus rule).`);
    }
  } else {
    throw new InvalidEvidenceCallError(`log_evidence only accepts lemma or rule ids, got "${call.itemId}".`);
  }

  return recordEvidence(db, {
    itemId: call.itemId,
    source: "tutor",
    sourceRef: call.sessionId ?? null,
    polarity: call.polarity,
    mode: call.mode as EvidenceMode,
    audioDerived: false,
    sessionId: call.sessionId ?? null,
  });
}
