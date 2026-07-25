import type { Db } from "../db";
import { localDay } from "../local-day";
import { countDueCards } from "../cards";
import { loadSyllabus } from "../syllabus";
import { itemLessonKind } from "../lessons/item-lessons";
import { conversationCredit } from "./conversation-credit";
import { currentStep, getSession, isSessionComplete, reconcileSession } from "./store";
import { lessonLabelFor, planSession } from "./plan";
import { describeSession, orderSteps, type StepKey } from "./steps";
import type { NoticeReason } from "./notices";
import type { LessonFallback } from "./lesson-body";

// The read-model the session runner walks (E-44). One GET, no model calls, no money.
//
// It carries the FROZEN session when one is open and the PLANNED one before that, so
// the home's preview and the runner's reality are the same object shape built by the
// same code — a preview that could disagree with the session it previews would be the
// same class of lie this milestone is deleting.

/**
 * The syllabus's own content for a rule item, or null for a lemma.
 *
 * A lemma has none by construction and that is a licence fact, not an omission: the
 * frequency lexicon is rank data (D-19 keeps the CC BY-NC glossaries out of the
 * shipped data path), so there is nothing truthful to show about a word without a
 * model call. It is exactly why `planSession` prefers a rule for the lesson step.
 */
export function syllabusFallback(itemId: string | null): LessonFallback | null {
  if (!itemId || itemLessonKind(itemId) !== "grammar") return null;
  const key = itemId.slice("rule:".length);
  const rule = loadSyllabus().rules.find((r) => r.key === key);
  if (!rule) return null;
  return { title: rule.title, description: rule.description, examples: rule.examples, cefr: rule.cefr };
}

export interface SessionView {
  day: string;
  /** True once today's session row exists. */
  started: boolean;
  steps: StepKey[];
  doneSteps: StepKey[];
  /** The step to show, or null when the session is finished. */
  step: StepKey | null;
  complete: boolean;
  lesson: { itemId: string; label: string | null; kind: "grammar" | "vocab" } | null;
  /** Cards the drills step set out to do, and how many are still due right now. */
  plannedCards: number;
  cardsDue: number;
  letterWeek: string | null;
  /** A conversation has met its minimum today. */
  conversationMet: boolean;
  /** Steps not in today's session, with the reason — the home may state them. */
  omitted: { key: StepKey; reason: NoticeReason }[];
  /** The one factual line: what today holds. */
  summary: string;
}

export function buildSessionView(db: Db, day: string = localDay()): SessionView {
  const session = reconcileSession(db, day) ?? getSession(db, day);
  const plan = planSession(db, day);

  const steps = session ? session.steps : plan.steps;
  const doneSteps = session ? session.doneSteps : [];
  const lessonItemId = session ? session.lessonItemId : plan.lessonItemId;
  const kind = lessonItemId ? itemLessonKind(lessonItemId) : null;

  return {
    day,
    started: session !== null,
    steps: orderSteps(steps),
    doneSteps: orderSteps(doneSteps),
    step: session ? currentStep(session) : (steps[0] ?? null),
    complete: isSessionComplete(session),
    lesson:
      lessonItemId && kind
        ? { itemId: lessonItemId, label: lessonLabelFor(lessonItemId), kind }
        : null,
    plannedCards: session ? session.plannedCards : plan.plannedCards,
    cardsDue: countDueCards(db),
    letterWeek: plan.letterWeek,
    conversationMet: conversationCredit(db, day).met,
    omitted: session ? [] : plan.omitted,
    summary: describeSession({
      steps,
      lessonLabel: lessonItemId ? lessonLabelFor(lessonItemId) : null,
      cards: session ? session.plannedCards : plan.plannedCards,
    }),
  };
}
