import type { ItemKind } from "./knowledge/types";
import type { KindProgress, ProgressView } from "./progress";

// The sentences the progress surface says (E-46 criterion 7). PURE, exported and
// tested — because the last time this repo left a claim about the learner inline in
// a page component, restoring the exact false sentence kept 994 of 994 tests green
// (REVIEW-64 F3). A screen whose whole purpose is to state facts about somebody gets
// its facts tested.
//
// The rule every line below obeys: say what was observed, or say that nothing was.
// Never a percentage of an unknown total, never a trend no code path computes, never
// a "0" dressed as a measurement.

export const KIND_LABEL: Record<ItemKind, string> = {
  lemma: "Words",
  rule: "Grammar",
  phone: "Sounds",
};

/** What "you have shown you have" means, said once where the reader can see it. */
export const KNOWN_EXPLAINER =
  "Counted only when you have produced it correctly on two different days, at least once unprompted. Recognising a word is not enough.";

/**
 * The line under a kind's headline number.
 *
 * "Not started" is the point: an item kind with nothing observed is not zero
 * percent of anything, it is unmeasured, and rendering a 0 next to two real numbers
 * invites the reader to compare them.
 */
export function kindLine(k: KindProgress): string {
  if (k.known === 0 && k.inProgress === 0 && k.lapsed === 0) return "Not started";
  const parts: string[] = [];
  if (k.inProgress > 0) parts.push(`${k.inProgress} in progress`);
  if (k.lapsed > 0) parts.push(`${k.lapsed} slipped`);
  return parts.length > 0 ? parts.join(" · ") : "nothing else yet";
}

/** How this learner's level is described, including whether to trust it. */
export function levelLine(v: Pick<ProgressView, "level" | "levelCalibrated">): string {
  if (!v.level) return "No level has been estimated yet.";
  return v.levelCalibrated
    ? `Placed around ${v.level}.`
    : `Placed around ${v.level} — a rough estimate. Re-take the check in Settings to sharpen it.`;
}

/** The "this week" headline. Plural-aware, and honest about an empty week. */
export function weekLine(movedCount: number): string {
  if (movedCount === 0) return "Nothing has moved in the last seven days.";
  return `${movedCount} ${movedCount === 1 ? "thing" : "things"} moved in the last seven days.`;
}

/**
 * The "still fossilized" headline. The distinction that matters: having no
 * fossilized mistakes because they were all resolved is an achievement, while
 * having none because nothing has ever been observed is not — and saying the same
 * sentence for both would be this screen's cheapest lie.
 */
export function fossilLine(v: Pick<ProgressView, "fossilized" | "hasEvidence" | "map">): string {
  if (v.fossilized.length > 0) {
    return `${v.fossilized.length} ${v.fossilized.length === 1 ? "mistake keeps" : "mistakes keep"} coming back.`;
  }
  const anySlips = v.map.some((c) => c.slips > 0);
  if (!anySlips) return "No recurring mistakes have been found yet.";
  return "Nothing is stuck right now.";
}
