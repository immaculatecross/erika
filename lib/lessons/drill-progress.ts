import { countsAsCorrect, evidenceForOutcome, nextMishearingStreak, speechIsOffered, type DrillOutcome } from "./drill-session";

// ─────────────────────────────────────────────────────────────────────────────
// THE DRILL SEQUENCE, AS A PURE REDUCER (E-45 delta repair).
//
// Why this exists rather than a test that pokes a React component.
//
// The Full review's delta found that reintroducing B1 (write evidence the moment
// speech-to-text disagrees) and B2 (reset the mishearing streak on the resolve that
// precedes every dispute) both SURVIVED the whole 1330-test suite. The tests I had
// added reach `DrillCard`, not the runner, so they could not have caught either —
// the commit subject that claimed otherwise was wrong, and a test that cannot fail
// is worse than none.
//
// A component-level test would need a DOM (`jsdom` + a click-firing library), and
// this repo has neither — `vitest.config.ts` runs `environment: "node"` and the
// render tests use `renderToStaticMarkup`, which cannot dispatch an event. Adding
// both dependencies to test two state transitions is a large answer to a small
// question, and it would still leave the transitions living in a component.
//
// So the sequence moves OUT of component state entirely. `drillProgress` is a pure
// reducer over the two things a learner does — resolve a drill, then leave it — and
// it returns the effect rather than performing it. The components become dispatch
// and rendering with no sequencing of their own, which means:
//
//   * D1 and D2 can only be reintroduced by editing THIS file, where a plain unit
//     test sees them (tests/drill-progress.test.ts);
//   * and the two surfaces that run drills — the standalone lesson runner and E-44's
//     session step — share one implementation instead of two dialects, which is the
//     failure mode that produced two defects in v0.6 (RETRO-004).
//
// THE INVARIANT, restated: **a voice answer may only ever write evidence the learner
// has not disputed.** `evidence` is append-only with RAISE(ABORT) triggers, so the
// only way to honour it is ordering — `resolve` records nothing and opens the dispute
// window; `advance` is the write.
// ─────────────────────────────────────────────────────────────────────────────

export type { DrillOutcome };

export interface DrillProgress {
  /** Which drill the learner is on. */
  index: number;
  /** How many drills counted as answered (a disputed one counts — they did the work). */
  correctCount: number;
  /** Consecutive "that's not what I said" disputes. Only a dispute advances it. */
  mishearings: number;
  /** The outcome of the drill on screen, or null while it is unanswered. This is
   *  the DISPUTE WINDOW: a drill may resolve several times (wrong, then disputed)
   *  and only the last one is what gets written. */
  pending: DrillOutcome | null;
  /** True once the learner has left the last drill. */
  finished: boolean;
}

export type DrillAction =
  | { type: "resolve"; outcome: DrillOutcome }
  | { type: "advance"; total: number };

/**
 * What the caller must DO as a result of a transition. Returned rather than
 * performed, so the decision is testable and the component is not.
 */
export interface DrillEffect {
  /** Polarity to append as cued evidence, or null for "write nothing". */
  write: boolean | null;
}

export const initialDrillProgress: DrillProgress = {
  index: 0,
  correctCount: 0,
  mishearings: 0,
  pending: null,
  finished: false,
};

/**
 * One transition. `resolve` NEVER writes — that is the whole guarantee. `advance`
 * is where the drill's final outcome becomes evidence, the score, and the streak.
 */
export function drillProgress(state: DrillProgress, action: DrillAction): [DrillProgress, DrillEffect] {
  if (action.type === "resolve") {
    // Opens (or re-opens) the dispute window. Records nothing, by construction.
    return [{ ...state, pending: action.outcome }, { write: null }];
  }

  // advance
  if (state.pending === null) return [state, { write: null }];
  const outcome = state.pending;
  const last = state.index >= action.total - 1;
  return [
    {
      index: last ? state.index : state.index + 1,
      correctCount: state.correctCount + (countsAsCorrect(outcome) ? 1 : 0),
      mishearings: nextMishearingStreak(state.mishearings, outcome),
      pending: null,
      finished: last,
    },
    { write: evidenceForOutcome(outcome) },
  ];
}

/** Whether speech is still offered at this point in the session. */
export function drillSpeechOffered(state: DrillProgress): boolean {
  return speechIsOffered(state.mishearings);
}
