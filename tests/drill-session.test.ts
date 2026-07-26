import { describe, expect, it } from "vitest";
import {
  MISHEARD_STREAK_TO_FALL_BACK,
  countsAsCorrect,
  evidenceForOutcome,
  nextMishearingStreak,
  speechIsOffered,
  type DrillOutcome,
} from "@/lib/lessons/drill-session";

// ─────────────────────────────────────────────────────────────────────────────
// THE TWO DEFECTS THIS FILE EXISTS TO HAVE CAUGHT (E-45 Full review, B1 + B2).
//
// Both lived in React state inside components/lesson-runner.tsx, and NO TEST
// REACHED THE RUNNER AT ALL — a grep over tests/ and e2e/ returned nothing. So
// both were verifiable only by reading, and both read plausibly:
//
//   B1  a spoken answer that speech-to-text disagreed with wrote
//       `polarity: 0, mode: "cued"` IMMEDIATELY — before the "that's not what I
//       said" control had rendered. `evidence` has BEFORE UPDATE/DELETE
//       RAISE(ABORT) triggers, so that row was permanent: one bad transcript
//       demoted a lemma the learner actually knew, for good (D-19).
//
//   B2  the mishearing counter was reset by the very event that should have
//       incremented it (the spoken-wrong resolve ran `setMishearings(0)` and the
//       override followed), so the counter cycled 0→1 forever and the
//       three-strikes tap-only fallback was unreachable dead code. The answer the
//       work order asked for did not exist in the product.
//
// The rules now live in a pure module, which is the fix for the CLASS: an
// invariant held in React state is verified only by reading, and this repo has
// been bitten by that three times (RETRO-004).
// ─────────────────────────────────────────────────────────────────────────────

const OUTCOMES: DrillOutcome[] = ["correct", "incorrect", "misheard"];

describe("B1 — a disputed voice answer writes nothing, in either direction", () => {
  it("writes positive for a correct answer and negative for an undisputed wrong one", () => {
    expect(evidenceForOutcome("correct")).toBe(true);
    expect(evidenceForOutcome("incorrect")).toBe(false);
  });

  it("writes NOTHING for a disputed answer — not negative, and not positive either", () => {
    // Negative would punish the learner for our transcript; positive would claim we
    // verified something we did not. Silence is the only honest record.
    expect(evidenceForOutcome("misheard")).toBeNull();
  });

  it("has exactly one outcome that records nothing, so `null` is not a catch-all", () => {
    expect(OUTCOMES.filter((o) => evidenceForOutcome(o) === null)).toEqual(["misheard"]);
  });

  it("still counts a disputed drill as done — the learner did the work", () => {
    expect(countsAsCorrect("misheard")).toBe(true);
    expect(countsAsCorrect("correct")).toBe(true);
    expect(countsAsCorrect("incorrect")).toBe(false);
  });
});

describe("B2 — the third consecutive mishearing actually falls back", () => {
  it("advances the streak on a dispute and resets it on anything else", () => {
    expect(nextMishearingStreak(0, "misheard")).toBe(1);
    expect(nextMishearingStreak(2, "misheard")).toBe(3);
    // THE BUG, PINNED: an undisputed outcome resets. Previously the spoken-wrong
    // resolve that PRECEDED every dispute did the resetting, so the streak could
    // never reach two.
    expect(nextMishearingStreak(2, "incorrect")).toBe(0);
    expect(nextMishearingStreak(2, "correct")).toBe(0);
  });

  it("reaches the fallback after three disputes IN A ROW, and not before", () => {
    // Drive the real sequence the learner produces, one drill at a time.
    let streak = 0;
    const offered: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      offered.push(speechIsOffered(streak));
      streak = nextMishearingStreak(streak, "misheard");
    }
    // Speech is offered for the first three drills and withdrawn for the fourth.
    expect(offered).toEqual([true, true, true, false]);
    expect(streak).toBe(MISHEARD_STREAK_TO_FALL_BACK + 1);
  });

  it("a single good drill in between resets the run — the rule is CONSECUTIVE", () => {
    let streak = 0;
    for (const outcome of ["misheard", "misheard", "correct", "misheard", "misheard"] as DrillOutcome[]) {
      streak = nextMishearingStreak(streak, outcome);
    }
    expect(streak).toBe(2);
    expect(speechIsOffered(streak)).toBe(true);
  });

  it("does not withdraw speech for a learner who is simply getting drills wrong", () => {
    let streak = 0;
    for (let i = 0; i < 10; i++) streak = nextMishearingStreak(streak, "incorrect");
    expect(speechIsOffered(streak)).toBe(true);
  });

  it("three is the threshold, stated once", () => {
    expect(MISHEARD_STREAK_TO_FALL_BACK).toBe(3);
    expect(speechIsOffered(MISHEARD_STREAK_TO_FALL_BACK - 1)).toBe(true);
    expect(speechIsOffered(MISHEARD_STREAK_TO_FALL_BACK)).toBe(false);
  });
});

describe("the ordering guarantee, as a sequence", () => {
  it("a mishearing followed by a correct answer leaves ONE positive row and no negative", () => {
    // The scenario B1 got wrong end to end: the learner says the right thing, STT
    // mishears, they dispute, they move on, then they answer the next drill.
    const written = (["misheard", "correct"] as DrillOutcome[])
      .map(evidenceForOutcome)
      .filter((p): p is boolean => p !== null);
    expect(written).toEqual([true]);
    expect(written).not.toContain(false);
  });
});
