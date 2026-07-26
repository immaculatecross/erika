import { MISHEARD_STREAK_TO_FALL_BACK } from "./spoken-answer";

// ─────────────────────────────────────────────────────────────────────────────
// THE RULES OF A DRILL SESSION — pure, so they can be tested (E-45 repair).
//
// These three decisions used to live inside `components/lesson-runner.tsx` as
// React state updates, and BOTH of them were wrong in ways no test could see,
// because no test reached the runner at all:
//
//   * evidence was written the instant speech-to-text disagreed with the learner,
//     BEFORE the "that's not what I said" control had even rendered — and the
//     `evidence` table has BEFORE UPDATE/DELETE RAISE(ABORT) triggers, so that row
//     could never be taken back. A bad transcript permanently demoted a lemma the
//     learner actually knew (D-19);
//   * the mishearing counter was reset by the very event that should have
//     incremented it, so the three-strikes fallback was unreachable dead code.
//
// Moving them here is the fix for the class, not the instance: an invariant held
// only in React state is verified only by reading, and this repo has now been bitten
// by that three times (RETRO-004). Everything below is a pure function over an
// outcome, and `tests/drill-session.test.ts` drives each one directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a drill ended.
 *
 *   `correct`   — answered right, by tap or by voice.
 *   `incorrect` — answered wrong, and the learner did NOT dispute it.
 *   `misheard`  — the learner said "that's not what I said". Their word is final:
 *                 we are not the authority on what came out of their mouth.
 */
export type DrillOutcome = "correct" | "incorrect" | "misheard";

/**
 * THE INVARIANT THIS MODULE EXISTS FOR:
 *
 *   **A voice answer may only ever write evidence the learner has not disputed.**
 *
 * Because `evidence` is append-only and unretractable (v14 triggers), the only way
 * to honour that is to write AFTER the dispute window rather than before it. So the
 * runner records nothing when a drill resolves; it records when the learner LEAVES
 * the drill, by which time they have had the transcript in front of them and the
 * chance to reject it.
 *
 * Returns the polarity to append, or `null` for "write nothing".
 *
 * A disputed drill writes nothing in EITHER direction — not negative (we have no
 * reason to think they were wrong) and not positive (we did not verify they were
 * right). Silence is the only honest record of an event we did not observe.
 */
export function evidenceForOutcome(outcome: DrillOutcome): boolean | null {
  if (outcome === "misheard") return null;
  return outcome === "correct";
}

/**
 * The mishearing streak after a drill ends.
 *
 * Only a DISPUTE advances it, and any undisputed outcome resets it — which is the
 * bug fixed here in one line. Previously a spoken wrong answer resolved to
 * `incorrect` first and zeroed the counter, so the override that followed could
 * never be the second in a row and the fallback below was unreachable.
 */
export function nextMishearingStreak(streak: number, outcome: DrillOutcome): number {
  return outcome === "misheard" ? streak + 1 : 0;
}

/**
 * Whether speech is still offered. False once the learner has disputed
 * MISHEARD_STREAK_TO_FALL_BACK times in a row: at that point recognition is not
 * working for this voice today, and continuing to offer it is asking someone to
 * keep failing at something we already know is broken. Every drill has options, so
 * the session finishes on the tap path with nothing lost.
 */
export function speechIsOffered(streak: number): boolean {
  return streak < MISHEARD_STREAK_TO_FALL_BACK;
}

/** How the drill counts toward the lesson score. A disputed drill counts as
 *  answered — the learner did the work; only our transcript failed. */
export function countsAsCorrect(outcome: DrillOutcome): boolean {
  return outcome !== "incorrect";
}

export { MISHEARD_STREAK_TO_FALL_BACK };
