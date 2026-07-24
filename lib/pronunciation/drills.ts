import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { getIncludedFinding, listIncludedFindings } from "../findings-model";
import { MAX_DRILL_SECONDS } from "./types";

// What the studio drills, and where a drill COMES FROM (E-37, RETRO-002 P4 /
// RETRO-003).
//
// Analysis already produces pronunciation signal in two places, and both used to
// dead-end in a text cloze that could not test the thing it was about — you cannot
// check a mispronunciation by asking someone to type a word whose spelling was never
// wrong (RETRO-003):
//
//   * a finding whose `category` is `pronunciation` — the schema-enforced category the
//     triage and deep prompts both ask for; and
//   * the E-28 richness-dial note `notes.pronunciation`, which rides on a finding of
//     ANY category and is likely the larger signal. The deep prompt frames it exactly
//     as D-21 wants — "a note, never a score".
//
// Both now become scored re-record drills. And because more producers are coming (a
// follow-up milestone will capture the Realtime tutor's in-conversation pronunciation
// observations), "what becomes a drill" is a SEAM, not a hard-wire: a `DrillSource`
// lists and resolves candidates, the studio consumes `DrillCandidate`s, and a new
// producer is a new entry in `DRILL_SOURCES` — no change to the money path, the
// scoring, the view model or the UI.
//
// Findings are read EXCLUSIVELY through lib/findings-model.ts (E-17 — no feature
// carries its own gate over `findings`), so the studio can never show a drill for a
// finding the Phrasebook, the report or Focus would hide.
//
// D-18 is absolute: a drill's reference text is the **correct** target — a finding's
// correction, never the learner's `quote`. The `suspect` note is shown as context at
// feedback time, never as the stimulus.

/** One scripted drill: a correct Italian line to hear, then say. */
export interface PronunciationDrill {
  /** `<source>:<ref>` — stable, unique across producers; attempts file under it. */
  drillKey: string;
  /** Which producer this came from (`finding` today). */
  source: string;
  /** The producer's own reference for it (a finding id today). */
  sourceRef: string;
  /** The finding this drill came from, when it came from one — the studio reuses the
   *  E-33 phrase-render endpoints keyed by finding id for the native rendition. Null
   *  for a producer that is not finding-backed. */
  findingId: string | null;
  /** The CORRECT phrase to render and re-record (D-18). */
  referenceText: string;
  /** Why it is the correct form — display only. */
  explanation: string;
  /** A quiet label (the finding's category today). */
  label: string;
  /** The flagged pronunciation suspect, or null. A note, never a score (D-21). */
  suspect: string | null;
}

/**
 * A producer of drill candidates. Implement one and add it to `DRILL_SOURCES`; the
 * studio needs nothing else. `get` MUST apply the same eligibility the producer's
 * `list` applies, so an arbitrary ref can never be turned into a billed assessment.
 */
export interface DrillSource {
  /** The `source` half of every `drillKey` this producer mints. */
  readonly id: string;
  list(db: Db, limit: number): PronunciationDrill[];
  get(db: Db, sourceRef: string): PronunciationDrill | null;
}

export function drillKeyOf(source: string, sourceRef: string): string {
  return `${source}:${sourceRef}`;
}

/** Split a drill key into its producer and ref. The ref may itself contain colons, so
 *  only the FIRST separator is significant. */
export function parseDrillKey(drillKey: string): { source: string; sourceRef: string } | null {
  const i = drillKey.indexOf(":");
  if (i <= 0 || i === drillKey.length - 1) return null;
  return { source: drillKey.slice(0, i), sourceRef: drillKey.slice(i + 1) };
}

/** The key a finding-sourced drill files attempts under. */
export function drillKeyForFinding(findingId: string): string {
  return drillKeyOf(FINDING_SOURCE_ID, findingId);
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

/** Is this a line we can honestly offer as a drill at all? */
function drillable(referenceText: string): boolean {
  return referenceText.trim() !== "" && drillFitsShortAudio(referenceText);
}

// ---- the findings producer ------------------------------------------------

const FINDING_SOURCE_ID = "finding";

/**
 * Whether a finding belongs in the studio: it is a pronunciation-category finding, OR
 * the deep pass attached a `notes.pronunciation` suspect to it (whatever its category
 * — that channel is orthogonal to the category vocabulary). One predicate, so the list
 * and the single-drill read can never disagree about what the studio covers.
 */
export function isPronunciationFinding(f: Pick<Finding, "category" | "notes">): boolean {
  return f.category === "pronunciation" || !!f.notes?.pronunciation;
}

function findingToDrill(f: Finding): PronunciationDrill {
  return {
    drillKey: drillKeyForFinding(f.id),
    source: FINDING_SOURCE_ID,
    sourceRef: f.id,
    findingId: f.id,
    referenceText: f.correction,
    explanation: f.explanation,
    label: f.category,
    suspect: f.notes?.pronunciation ?? null,
  };
}

/** The one producer today: pronunciation findings and richness-dial pronunciation
 *  notes, both read through the canonical findings model (E-17). */
export const findingDrillSource: DrillSource = {
  id: FINDING_SOURCE_ID,
  list(db, limit) {
    return listIncludedFindings(db)
      .filter(isPronunciationFinding)
      .filter((f) => drillable(f.correction))
      .slice(0, limit)
      .map(findingToDrill);
  },
  get(db, sourceRef) {
    const f = getIncludedFinding(db, sourceRef);
    if (!f || !isPronunciationFinding(f) || !drillable(f.correction)) return null;
    return findingToDrill(f);
  },
};

/** Every producer of drills. A new one (the tutor's observations, a syllabus minimal
 *  pair) is added HERE and nowhere else. */
export const DRILL_SOURCES: readonly DrillSource[] = [findingDrillSource];

// ---- the studio's two reads ----------------------------------------------

/** Every drill the studio can offer, newest first within each producer. */
export function listPronunciationDrills(db: Db, limit = 50): PronunciationDrill[] {
  return DRILL_SOURCES.flatMap((s) => s.list(db, limit)).slice(0, limit);
}

/**
 * One drill by key, or null when its producer does not recognise it (unknown source,
 * a finding outside the E-17 included scope, not a pronunciation finding, or too long
 * for the short-audio path). The single door the scoring route goes through, so an
 * arbitrary id can never be turned into a billed assessment.
 */
export function resolveDrill(db: Db, drillKey: string): PronunciationDrill | null {
  const parsed = parseDrillKey(drillKey);
  if (!parsed) return null;
  const source = DRILL_SOURCES.find((s) => s.id === parsed.source);
  return source ? source.get(db, parsed.sourceRef) : null;
}

/** Convenience for the finding-backed path (tests, the routing proof). */
export function pronunciationDrill(db: Db, findingId: string): PronunciationDrill | null {
  return findingDrillSource.get(db, findingId);
}
