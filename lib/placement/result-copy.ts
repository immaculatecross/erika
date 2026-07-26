import type { PlacementCaveat } from "./scoring";

// The sentence the placement result screen shows (E-35, D-24). A PURE function of the
// route's response — no React, no I/O — so it can be unit-tested against the SAME responses
// the write-path tests assert the database on.
//
// [REVIEW-64 F3] It lived inside `app/practice/placement/page.tsx`, unexported and therefore
// untestable. Restoring the exact pre-PR false sentence left the whole 994-test suite green:
// the copy half of "the copy matches the writes" was guarded by prose only, in a repo whose
// last release shipped four vacuous tests. It is a claim the app makes about the learner, so
// it gets the same treatment as the writes — a test per state, driven from real responses.
//
// [RETRO-004 §DE-2] The result line used to be "Placed around C2." with the single sentence
// "This is a rough placement." appended when `!calibrated` — and `calibrated` only checked
// sample sizes, so a run that FAILED A1 and A2 was shown as a confident C2 with no caveat at
// all. The scorer now refuses to claim a level whose lower bands fail and reports WHY
// confidence is low; this states both, plainly, and never implies more than was measured.
// Calm and factual, no alarm and no cheerleading (D-24).

/** Everything the line needs. A subset of the `POST /api/placement` response — every field
 *  is READ from the server rather than assumed, which is the whole point (REVIEW-64 F4). */
export interface PlacementResultView {
  level: string | null;
  calibrated: boolean;
  /** Why the estimate is rough — see `PlacementCaveat`. */
  caveat?: PlacementCaveat | null;
  seededWords: number;
  seededRules: number;
  /** Items a PREVIOUS placement had marked seen that this run does not — they have just
   *  left the daily plan. Returned by the route and, until REVIEW-64 F4, never read. */
  supersededItems: number;
  /** The answers never reached the server, so nothing was scored (REVIEW-64 N5). */
  submitFailed?: boolean;
  /** Which measurement the level came from (E-46 criteria 3, 10). Absent on a run with
   *  no spoken sample, which is every run before this milestone — so the sentence is
   *  unchanged for them. */
  levelSource?: "check" | "spoken" | "none";
}

export const CAVEAT_REASON: Record<PlacementCaveat, string> = {
  "response-style":
    "Several invented words were marked known, so the answers cannot separate the words you know from the ones you do not.",
  // [REVIEW-64 N3] The check is supposed to include invented words; without them there is no
  // way to tell a confident "yes" from a hopeful one.
  "no-control": "The check included no invented words, so there was no way to tell a real yes from a guess.",
  // [REVIEW-64 F4] Was "…so only the run from the most common words up is counted", which is
  // false on this branch: when no level is claimed, nothing was counted. The reason now
  // reports only what was observed and leaves the consequence to the sentence around it.
  inconsistent: "Recognition was uneven — some less common words were marked known while more common ones were not.",
  // [REVIEW-63 N1, REVIEW-64 N4] Was "The check was short." — still true, but the caveat now
  // also fires when a frequency level went unasked, or was asked with the same word repeated.
  "thin-sample": "The check did not ask enough different words at every frequency level, or enough invented words to check against.",
};

/** Plural-aware "N word(s)". */
const words = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;

/**
 * The honest line when no level can be claimed. Three facts, each read from the response:
 * the reason, what this run wrote, and what it RETRACTED.
 *
 * [REVIEW-63 F1] The middle clause used to be an unconditional "Nothing has been assumed
 * about your level — your daily plan is unchanged", while the run that produced it had just
 * written 39 recognition rows.
 *
 * [REVIEW-64 F4] The last clause is the mirror image, and the more sympathetic one: an
 * `inconsistent` or `thin-sample` run IS recorded, which supersedes the previous placement.
 * Measured: an honest learner (fa 0 — every invented word correctly rejected) placed at B2
 * with 173 rules, then an uneven retake, returned `supersededItems: 275`, dropped all 173
 * rules to `unseen` and changed the plan — while this line said "nothing else has changed".
 * `supersededItems` was returned by the route the whole time and never read.
 */
function unplaceableLine(r: PlacementResultView): string {
  const reason = r.caveat ? ` ${CAVEAT_REASON[r.caveat]}` : "";
  const wrote =
    r.seededWords > 0
      ? `No level has been assumed. The ${words(r.seededWords)} you marked as known ${r.seededWords === 1 ? "is" : "are"} noted.`
      : "Nothing has been assumed about your level, and nothing was added to your model.";
  const retracted =
    r.supersededItems > 0
      ? ` The ${r.supersededItems} ${r.supersededItems === 1 ? "item" : "items"} your previous check had marked as seen ${r.supersededItems === 1 ? "is" : "are"} no longer counted, so your daily plan has changed.`
      : r.seededWords > 0
        ? " Nothing else has changed."
        : " Your daily plan is unchanged.";
  return `The check could not place you.${reason} ${wrote}${retracted} You can take the check again whenever you like.`;
}

export function levelLine(r: PlacementResultView): string {
  // [REVIEW-64 N5] A transport failure is not a placement. The catch in `submit()` used to
  // produce `{level: null, caveat: undefined}`, which fell through to "Placed at the very
  // start. This is a rough placement." — the app reporting a result it never received.
  if (r.submitFailed) {
    return "Your answers could not be sent, so the check was not scored and nothing has changed. You can try again whenever you like.";
  }

  // No level AND a reason to distrust the answers: say so, rather than reporting a beginner
  // who never said they were one. [REVIEW-63 N1] `thin-sample` is included: the scorer refuses
  // a level when a band was never measured, and "Placed at the very start." would be a claim
  // about someone the check never asked. A level-less run with NO caveat is a real
  // measurement (A1 asked and not recognized, non-words rejected) and still reads as the very
  // start — the true beginner, who must not be handed a wall of hedging.
  if (r.level === null && r.caveat) return unplaceableLine(r);

  // [E-46 criteria 3, 10] The level came from the SPOKEN sample, not from the yes/no
  // answers. Two different sentences, because two different things happened, and reusing
  // the plain one would be a lie in both directions: it would credit the word check for a
  // level it did not produce, and — in the rescued case — it would append "this is a rough
  // placement, several invented words were marked known" to a level those answers had no
  // hand in. Every clause below is still read from the response, never assumed.
  if (r.levelSource === "spoken" && r.level) {
    const rules =
      r.seededRules > 0
        ? ` ${r.seededRules} grammar ${r.seededRules === 1 ? "point" : "points"} below it ${r.seededRules === 1 ? "is" : "are"} marked seen.`
        : "";
    if (r.caveat) {
      return `The word check could not be measured. ${CAVEAT_REASON[r.caveat]} Your speaking sample placed you around ${r.level}, so that is where you start.${rules} The words you marked are not counted.`;
    }
    return `Placed around ${r.level}. Your speaking sample placed you higher than the word check did, so the higher one is used.${rules}`;
  }

  const where = r.level ? `around ${r.level}` : "at the very start";
  // Verb agreement, not decoration: writing the test for these states surfaced "1 word you
  // knew are now in your model" — an inline, unexported, untested sentence for two releases.
  const seeded =
    r.seededWords > 0 ? ` ${words(r.seededWords)} you knew ${r.seededWords === 1 ? "is" : "are"} now in your model.` : "";
  const rules =
    r.seededRules > 0
      ? ` ${r.seededRules} grammar ${r.seededRules === 1 ? "point" : "points"} below it ${r.seededRules === 1 ? "is" : "are"} marked seen.`
      : "";
  const rough = r.calibrated ? "" : ` This is a rough placement.${r.caveat ? ` ${CAVEAT_REASON[r.caveat]}` : ""}`;
  return `Placed ${where}.${seeded}${rules}${rough}`;
}
