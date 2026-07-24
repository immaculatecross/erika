import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { getIncludedFinding, listIncludedFindings } from "../findings-model";
import { MAX_DRILL_SECONDS } from "./types";

// What the studio drills, and where it comes from (E-37, RETRO-002 P4 / RETRO-003).
//
// Analysis surfaces pronunciation two ways, and BOTH used to dead-end:
//
//   * a finding whose `category` is `pronunciation`, and
//   * any finding carrying the E-28 enriched `notes.pronunciation` suspect — D-21's
//     "the LLM only FLAGS suspects" channel.
//
// Both became a text cloze that could not test the thing they were about: you cannot
// check a mispronunciation by asking someone to type a word (RETRO-003). They now
// become scored re-record drills instead — the destination those flags never had.
//
// Findings are read EXCLUSIVELY through lib/findings-model.ts (E-17 — no feature
// carries its own gate over `findings`), so the studio can never show a drill for a
// finding the Phrasebook, the report or Focus would hide.
//
// D-18 is absolute here: the drill's reference text is the finding's **correction** —
// the correct target — never the learner's `quote`. The studio asks you to say the
// right thing; it never replays your error as the thing to imitate. The `suspect`
// field below is displayed as context at feedback time, never as the stimulus.

/** One scripted drill: a correct Italian sentence to hear, then say. */
export interface PronunciationDrill {
  /** Stable key an attempt is filed under (`finding:<id>`). */
  drillKey: string;
  findingId: string;
  /** The CORRECT phrase to render and re-record — the finding's correction (D-18). */
  referenceText: string;
  /** Why it is the correct form — display only. */
  explanation: string;
  category: string;
  /** The flagged pronunciation suspect (E-28 `notes.pronunciation`), or null. A note,
   *  never a score (D-21). */
  suspect: string | null;
}

export function drillKeyForFinding(findingId: string): string {
  return `finding:${findingId}`;
}

/**
 * Whether a finding belongs in the studio: it is a pronunciation-category finding, or
 * the deep pass flagged a pronunciation suspect on it. One predicate, so the list and
 * the single-drill read can never disagree about what the studio covers.
 */
export function isPronunciationFinding(f: Pick<Finding, "category" | "notes">): boolean {
  return f.category === "pronunciation" || !!f.notes?.pronunciation;
}

/**
 * A rough drill-length guard. Azure's REST short-audio path caps assessed audio at 30
 * seconds; a one-sentence recast is far below that, but a correction that is really a
 * paragraph would produce a take that must be refused AFTER the learner has already
 * spoken. Estimating from the reference text (Italian is read at roughly 14 characters
 * per second aloud, deliberately conservative) lets the studio simply not offer such a
 * drill. A heuristic, not a measurement — the real length check is on the recording.
 */
const READ_CHARS_PER_SECOND = 14;

export function drillFitsShortAudio(referenceText: string): boolean {
  return referenceText.length / READ_CHARS_PER_SECOND <= MAX_DRILL_SECONDS;
}

function toDrill(f: Finding): PronunciationDrill {
  return {
    drillKey: drillKeyForFinding(f.id),
    findingId: f.id,
    referenceText: f.correction,
    explanation: f.explanation,
    category: f.category,
    suspect: f.notes?.pronunciation ?? null,
  };
}

/** Every pronunciation drill the studio can offer, newest first. */
export function listPronunciationDrills(db: Db, limit = 50): PronunciationDrill[] {
  return listIncludedFindings(db)
    .filter(isPronunciationFinding)
    .filter((f) => f.correction.trim() !== "" && drillFitsShortAudio(f.correction))
    .slice(0, limit)
    .map(toDrill);
}

/**
 * One drill by finding id, or null when the finding is outside the E-17 included
 * scope, is not a pronunciation finding, or is too long for the short-audio path. The
 * single door the scoring route goes through, so an arbitrary finding id can never be
 * turned into a billed assessment.
 */
export function pronunciationDrill(db: Db, findingId: string): PronunciationDrill | null {
  const f = getIncludedFinding(db, findingId);
  if (!f || !isPronunciationFinding(f)) return null;
  if (f.correction.trim() === "" || !drillFitsShortAudio(f.correction)) return null;
  return toDrill(f);
}
