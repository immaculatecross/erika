import type { Db } from "../db";
import { ensurePhoneItem, itemExists, phoneItemId } from "../knowledge/items";
import { recordEvidence } from "../knowledge/evidence";
import { attemptPassed } from "./view";
import type { PronunciationThresholds } from "./thresholds";
import type { PronunciationResult } from "./types";

// What a scored drill writes into the knowledge core (E-37, D-19). Two narrow moves,
// both through the ONE evidence door (`recordEvidence`) — no second write path.
//
// 1. SEED the phones the learner actually struggles with. `phone:` items have existed
//    since v14 and the daily composer already selects unseen ones ("N sounds at your
//    edge") — but nothing ever created any, which is why the Settings "Sounds" cap has
//    been inert. E-37 is where they come from, and they come from EVIDENCE rather than
//    a guess: a phone becomes an item the first time the learner produces it below the
//    shaky threshold in a real drill. Seeding only the weak ones keeps the inventory
//    meaningful — the composer's "sounds at your edge" is literally the set of sounds
//    this learner has mispronounced, not the Italian phoneme chart.
//
// 2. MINT cued positive evidence for phones produced WELL on a PASSING take. Mode is
//    always `cued` — a scripted drill is prompted production by definition, never
//    spontaneous (D-19). Consequence, and it is the point: cued evidence alone can
//    NEVER reach `known`, because the `known` gate requires at least one spontaneous
//    positive. A drill can move a sound to `learning`; only real, unprompted speech
//    can call it known.
//
// The evidence is audio-derived (the ×0.7 discount applies — it comes from a
// recording), sourced `exercise` (a drill is an exercise) and reference the attempt id
// so any row can be traced back to the take that produced it.
//
// A too-noisy take writes NOTHING: it is not a measurement of the learner, so it is
// not evidence about the learner either.

export interface KnowledgeWriteOutcome {
  /** Phone item ids created by this attempt (the weak sounds). */
  seeded: string[];
  /** Phone item ids that received a cued positive. */
  credited: string[];
}

/**
 * Apply one scored attempt to the knowledge core. Idempotent in the ways that matter:
 * `ensurePhoneItem` is an `INSERT OR IGNORE`, and evidence is append-only by design —
 * a genuine re-attempt is a NEW observation and SHOULD append a new row.
 *
 * Nothing here can mint `known` (there is no path to it from cued evidence), and
 * nothing here writes a negative: a low score seeds the target to work on, it is not
 * recorded as a fact about the learner's competence. That keeps the log to what D-19
 * says it holds — production the learner actually got right — while the studio itself
 * shows the misses.
 */
export function applyAttemptToKnowledge(
  db: Db,
  attemptId: string,
  result: PronunciationResult,
  thresholds: PronunciationThresholds,
): KnowledgeWriteOutcome {
  const outcome: KnowledgeWriteOutcome = { seeded: [], credited: [] };
  // A take too noisy to score is too noisy to be evidence — it describes the room.
  if (result.snrDb !== null && result.snrDb < thresholds.minSnrDb) return outcome;

  // Best score per distinct phoneme in this take — a sound produced well once and
  // badly once is judged on its best rendering, the same max-over-windows posture the
  // speaker filter takes (recall-first, never punitive).
  const best = new Map<string, number>();
  for (const w of result.words) {
    for (const p of w.phonemes) {
      const prev = best.get(p.phoneme);
      if (prev === undefined || p.accuracyScore > prev) best.set(p.phoneme, p.accuracyScore);
    }
  }

  const passed = attemptPassed(result, thresholds);
  for (const [phoneme, score] of best) {
    const id = phoneItemId(phoneme);
    if (score < thresholds.shaky) {
      // A weak sound: make sure it exists as an item so the composer can surface it.
      // No evidence row — it is a target, not an observation to log against them.
      if (!itemExists(db, id)) {
        ensurePhoneItem(db, phoneme);
        outcome.seeded.push(id);
      }
      continue;
    }
    // Produced well, on a passing take, for a sound already on their list: credit it.
    if (passed && score >= thresholds.good && itemExists(db, id)) {
      recordEvidence(db, {
        itemId: id,
        source: "exercise",
        sourceRef: attemptId,
        polarity: 1,
        mode: "cued", // a scripted drill is cued production — never spontaneous (D-19)
        audioDerived: true,
      });
      outcome.credited.push(id);
    }
  }
  return outcome;
}
