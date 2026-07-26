import { describe, expect, it } from "vitest";
import {
  drillProgress,
  drillSpeechOffered,
  initialDrillProgress,
  type DrillAction,
  type DrillOutcome,
  type DrillProgress,
} from "@/lib/lessons/drill-progress";
import { MISHEARD_STREAK_TO_FALL_BACK } from "@/lib/lessons/drill-session";

// ─────────────────────────────────────────────────────────────────────────────
// THE REGRESSION TEST FOR D1 AND D2 (E-45 delta review).
//
// The delta's mutation run reintroduced both original defects and BOTH SURVIVED the
// full 1330-test suite: the tests I had written reach `DrillCard`, not the drill
// SEQUENCE, so they could not have caught either. The sequence now lives in a pure
// reducer (lib/lessons/drill-progress.ts) precisely so this file can drive it.
//
// What is driven here is the real sequence of learner actions — resolve, maybe
// dispute, advance — and what is asserted is the EFFECT the caller is told to
// perform. Expectations come from the scripted actions, never from the reducer.
// ─────────────────────────────────────────────────────────────────────────────

const TOTAL = 4;

/** Run a script of actions, collecting every write the reducer asked for. */
function run(actions: DrillAction[], from: DrillProgress = initialDrillProgress) {
  let state = from;
  const writes: (boolean | null)[] = [];
  for (const action of actions) {
    const [next, effect] = drillProgress(state, action);
    state = next;
    writes.push(effect.write);
  }
  return { state, writes, written: writes.filter((w): w is boolean => w !== null) };
}

const resolve = (outcome: DrillOutcome): DrillAction => ({ type: "resolve", outcome });
const advance = (): DrillAction => ({ type: "advance", total: TOTAL });

describe("D1 — resolving a drill NEVER writes evidence", () => {
  it("records nothing on resolve, whatever the outcome", () => {
    // The whole guarantee, at its narrowest. `evidence` is append-only with
    // RAISE(ABORT) triggers, so a row written here could never be taken back.
    for (const outcome of ["correct", "incorrect", "misheard"] as DrillOutcome[]) {
      const { writes } = run([resolve(outcome)]);
      expect(writes, outcome).toEqual([null]);
    }
  });

  it("the SEQUENCE that produced the defect writes nothing negative", () => {
    // Exactly what a learner does: speaks correctly, is misheard, is told "Not
    // quite", disputes it, moves on. Before the fix this appended
    // `polarity: 0, mode: "cued"` at the first resolve — permanently.
    const { written } = run([resolve("incorrect"), resolve("misheard"), advance()]);
    expect(written).toEqual([]);
  });

  it("an undisputed wrong answer still writes the negative — the signal is not discarded", () => {
    // The opposite failure. Deferring the write must not become never writing one,
    // or every spoken drill becomes evidentially worthless and D-19 drifts toward
    // over-crediting.
    const { written } = run([resolve("incorrect"), advance()]);
    expect(written).toEqual([false]);
  });

  it("a correct answer writes the positive, once", () => {
    const { written } = run([resolve("correct"), advance()]);
    expect(written).toEqual([true]);
  });

  it("re-resolving overwrites the pending outcome rather than adding a second write", () => {
    const { written, state } = run([resolve("correct"), resolve("incorrect"), advance()]);
    expect(written).toEqual([false]);
    expect(state.pending).toBeNull();
  });

  it("advancing from an unanswered drill changes nothing and writes nothing", () => {
    const { state, writes } = run([advance()]);
    expect(writes).toEqual([null]);
    expect(state).toEqual(initialDrillProgress);
  });

  it("a disputed drill still counts as done — the learner did the work", () => {
    const { state } = run([resolve("misheard"), advance()]);
    expect(state.correctCount).toBe(1);
  });
});

describe("D2 — the third consecutive mishearing withdraws speech", () => {
  it("reaches the fallback across three real drills, and not before", () => {
    // Drive it the way the learner produces it: each dispute is PRECEDED by the
    // wrong-transcript resolve. That preceding resolve is what used to zero the
    // streak, which is why the fallback was unreachable dead code.
    let state = initialDrillProgress;
    const offered: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      offered.push(drillSpeechOffered(state));
      [state] = drillProgress(state, resolve("incorrect"));
      [state] = drillProgress(state, resolve("misheard"));
      [state] = drillProgress(state, advance());
    }
    expect(offered).toEqual([true, true, true, false]);
    expect(state.mishearings).toBe(MISHEARD_STREAK_TO_FALL_BACK + 1);
  });

  it("nothing is written across those three drills", () => {
    const { written } = run([
      resolve("incorrect"), resolve("misheard"), advance(),
      resolve("incorrect"), resolve("misheard"), advance(),
      resolve("incorrect"), resolve("misheard"), advance(),
    ]);
    expect(written).toEqual([]);
  });

  it("one good drill in between resets the run — the rule is CONSECUTIVE", () => {
    const { state } = run([
      resolve("misheard"), advance(),
      resolve("misheard"), advance(),
      resolve("correct"), advance(),
      resolve("misheard"), advance(),
    ]);
    expect(state.mishearings).toBe(1);
    expect(drillSpeechOffered(state)).toBe(true);
  });

  it("never withdraws speech from a learner who is simply getting drills wrong", () => {
    let state = initialDrillProgress;
    for (let i = 0; i < 10; i++) {
      [state] = drillProgress(state, resolve("incorrect"));
      [state] = drillProgress(state, advance());
    }
    expect(drillSpeechOffered(state)).toBe(true);
    expect(state.mishearings).toBe(0);
  });
});

describe("the sequence walks the lesson and stops at the end", () => {
  it("advances one drill at a time and finishes on the last", () => {
    let state = initialDrillProgress;
    const indices: number[] = [];
    for (let i = 0; i < TOTAL; i++) {
      indices.push(state.index);
      [state] = drillProgress(state, resolve("correct"));
      [state] = drillProgress(state, advance());
    }
    expect(indices).toEqual([0, 1, 2, 3]);
    expect(state.finished).toBe(true);
    expect(state.correctCount).toBe(TOTAL);
  });
});
