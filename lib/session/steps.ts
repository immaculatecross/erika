// The day's session, as pure vocabulary (E-44, D-26/D-27). Client-safe — no React,
// no DB, no I/O — so the step order, the sentence the home states, and the completion
// sentence are all unit-testable and shared by the server planner and the runner UI.
//
// ONE session a day, linear: lesson → drills → letter (once a week) → conversation.
// The learner chooses nothing to progress; the only decision they make is to start.
//
// WHY THE LETTER SITS THIRD and not last. It is a weekly digest of the week just
// gone, and its closing beat is "the one thing next week" — read immediately before
// the conversation, it primes what the conversation steers toward. Putting it after
// the conversation would end the day on last week instead of on the learner's own
// voice. Criterion 2's lesson → drills → conversation order is unaffected.

/** The steps a day's session can hold, in the order they always run. */
export const STEP_ORDER = ["lesson", "drills", "letter", "conversation"] as const;
export type StepKey = (typeof STEP_ORDER)[number];

export function isStepKey(x: unknown): x is StepKey {
  return typeof x === "string" && (STEP_ORDER as readonly string[]).includes(x);
}

/** Sort an arbitrary step collection into the canonical order, dropping unknowns and
 *  duplicates. Every list that reaches the learner passes through here, so a step can
 *  never appear twice or out of order however it was assembled or persisted. */
export function orderSteps(steps: readonly unknown[]): StepKey[] {
  const present = new Set(steps.filter(isStepKey));
  return STEP_ORDER.filter((k) => present.has(k));
}

/**
 * Why a step is NOT in today's session. A session holds only steps that can actually
 * run: a step Erika cannot deliver is never rendered as a row that refuses — it is
 * absent, and the reason is stated where it can be acted on (criterion 3).
 *
 * `permanent` is the field the copy rule hangs on. A condition that will still be
 * true tomorrow morning must never be described as "right now" or "just now" — that
 * is the RETRO-004 lie this milestone exists to delete — so the notice builder below
 * refuses to soften a permanent reason, and the tests assert it.
 */
export interface StepOmission {
  key: StepKey;
  /** Machine reason, so copy and tests never drift from the condition. */
  reason: "no-key" | "budget" | "nothing-to-teach" | "no-cards" | "letter-read" | "not-recorded";
  permanent: boolean;
}

/** The plural-aware count phrase for a drill step ("12 cards", "one card"). */
function cardsPhrase(n: number): string {
  if (n === 1) return "one card";
  return `${n} cards`;
}

export interface SessionShape {
  steps: readonly StepKey[];
  /** A short human label for the day's lesson ("the congiuntivo", "sperare"). */
  lessonLabel: string | null;
  /** How many cards the drills step holds. */
  cards: number;
}

/**
 * The ONE factual line the home states: what today holds. "A lesson on the
 * congiuntivo, 12 cards, and a conversation."
 *
 * Deliberately a description, not a promise of value — it says what is in the box.
 * It is built from the SAME frozen shape the runner walks, so the sentence and the
 * session can never disagree (before the session opens it is built from the planner's
 * preview of exactly that shape).
 */
export function describeSession(shape: SessionShape): string {
  const parts: string[] = [];
  for (const step of orderSteps(shape.steps)) {
    if (step === "lesson") {
      parts.push(shape.lessonLabel ? `a lesson on ${shape.lessonLabel}` : "a lesson");
    } else if (step === "drills") {
      parts.push(shape.cards > 0 ? cardsPhrase(shape.cards) : "a short drill");
    } else if (step === "letter") {
      parts.push("your letter for the week");
    } else {
      parts.push("a conversation");
    }
  }
  if (parts.length === 0) return "Nothing left to teach you today.";
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/** What the ledger recorded for a finished day, for the completion sentence. */
export interface DayFigures {
  cardsDone: number;
  lessonsDone: number;
  /** A conversation met its minimum on this day. */
  conversation: boolean;
}

/**
 * THE ONE factual completion sentence, once per day (D-24, DESIGN "The daily
 * ritual"). Numbers, never a cheer: "Done for today. One lesson, 12 cards, and a
 * conversation."
 *
 * It mirrors `describeSession` on purpose — the day's promise and the day's receipt
 * are the same sentence shape, so a learner can see that what was offered is what was
 * done. No exclamation mark, no adjective, no second beat: the ring closing is the
 * day's single celebratory moment and this is information beside it.
 */
export function completionSentence(figures: DayFigures): string {
  const parts: string[] = [];
  if (figures.lessonsDone === 1) parts.push("one lesson");
  else if (figures.lessonsDone > 1) parts.push(`${figures.lessonsDone} lessons`);
  if (figures.cardsDone > 0) parts.push(cardsPhrase(figures.cardsDone));
  if (figures.conversation) parts.push("a conversation");
  if (parts.length === 0) return "Done for today.";
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `Done for today. ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/** The single primary control the home offers — there is never more than one. */
export type HomeAction =
  | { kind: "place"; href: string; label: string }
  | { kind: "start"; href: string; label: string }
  | { kind: "continue"; href: string; label: string }
  | { kind: "none" };

export interface HomeState {
  /** Has the learner run the placement check (E-35)? */
  placed: boolean;
  /** Today's session row exists (the learner pressed Start at some point today). */
  started: boolean;
  /** Today is recorded complete. */
  complete: boolean;
  /** Today's session holds at least one step. */
  hasSteps: boolean;
}

/**
 * The home's one control, decided in one place so no surface can invent a second.
 *
 * Unplaced learners get "Find your level" instead of "Start today" — a product call,
 * argued in the PR: on a fresh install the three-minute vocabulary check is genuinely
 * the right first action (it is what makes every later lesson start at the learner's
 * edge instead of at the alphabet), and making it the ONE action keeps the screen at
 * one action rather than adding a second row beside Start. E-46 turns this into a
 * hard gate; today it is simply what the button says.
 */
export function homeAction(state: HomeState): HomeAction {
  if (state.complete) return { kind: "none" };
  if (!state.placed) return { kind: "place", href: "/practice/placement", label: "Find your level" };
  if (!state.hasSteps) return { kind: "none" };
  if (state.started) return { kind: "continue", href: "/practice/session", label: "Continue" };
  return { kind: "start", href: "/practice/session", label: "Start today" };
}
