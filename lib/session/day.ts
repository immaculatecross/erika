import type { Db } from "../db";
import { localDay } from "../local-day";
import {
  cardsReviewedToday,
  getDayCompletion,
  recordDayComplete,
  type DayCompletion,
} from "../day-ledger";
import { conversationCredit } from "./conversation-credit";
import { getSession, isSessionComplete, reconcileSession } from "./store";
import { planSession } from "./plan";
import type { DayFigures } from "./steps";

// THE DAY'S GOAL (E-44, criterion 4 / D-26). The day is complete when the SESSION is.
//
// What this replaces, and why it was the mechanical root of the problem: the goal used
// to count flashcards alone, and `completeDayIfMet` wrote `lessonsDone: 0` as a
// hard-coded literal. So a learner could read a lesson and hold a ten-minute Italian
// conversation and the day counted for nothing — every single thing the plan offered
// was, mechanically, optional. It read as a pile of optional errands because that is
// exactly what it was.
//
// RECORDED HISTORY IS NEVER REWRITTEN. Nothing here recomputes a past day. `day_ledger`
// rows are facts about the day they were written on, under whatever rule was in force
// then; `getDayCompletion` returns them untouched, `lib/streak/` reads only `local_day`
// and is unaffected, and the goal below is only ever evaluated for a day whose session
// row exists — which no past day has. The new rule therefore applies from the day it
// ships, forward, by construction rather than by a date check.

/** Today's progress through the session, and whether the day's goal is met. */
export interface DayGoal {
  /** Steps finished. */
  done: number;
  /** Steps in today's session — the ring's denominator. */
  total: number;
  met: boolean;
}

/**
 * Today's goal.
 *
 * Before the learner starts, the denominator is the PLAN's step count — so the ring
 * and the home's sentence describe the same day. Once the session is open it is the
 * FROZEN step count, so the ring cannot move under the learner's feet.
 */
export function dayGoal(db: Db, day: string = localDay()): DayGoal {
  const session = reconcileSession(db, day) ?? getSession(db, day);
  if (session) {
    const done = session.steps.filter((s) => session.doneSteps.includes(s)).length;
    return { done, total: session.steps.length, met: isSessionComplete(session) };
  }
  const plan = planSession(db, day);
  return { done: 0, total: plan.steps.length, met: false };
}

/** The figures the completion sentence states — all derived from durable state, never
 *  from a client-reported count. */
export function dayFigures(db: Db, day: string = localDay()): DayFigures {
  const session = getSession(db, day);
  return {
    cardsDone: cardsReviewedToday(db, day),
    lessonsDone: session?.doneSteps.includes("lesson") ? 1 : 0,
    conversation: conversationCredit(db, day).met,
  };
}

/**
 * Record the day complete if its session is finished — the authoritative check, run
 * server-side, never on the client's say-so. Idempotent through the ledger's
 * `local_day` PK: the first call writes the row and every later one returns it
 * unchanged, so the figures the one-per-day sentence states never move.
 *
 * `lessonsDone` is now a real count of the lesson step the learner actually finished,
 * which is the literal criterion 4 asks to delete.
 */
export function completeDayIfMet(db: Db, day: string = localDay()): DayCompletion | null {
  const existing = getDayCompletion(db, day);
  if (existing) return existing;
  if (!dayGoal(db, day).met) return null;
  const figures = dayFigures(db, day);
  recordDayComplete(db, day, { cardsDone: figures.cardsDone, lessonsDone: figures.lessonsDone });
  return getDayCompletion(db, day);
}

/** The completion figures for a recorded day: the ledger's own numbers (never
 *  recomputed — that is what "history is not rewritten" means), plus whether a
 *  conversation was credited, which the ledger has no column for and which is a
 *  durable fact of its own. */
export function completionFigures(db: Db, completion: DayCompletion): DayFigures {
  return {
    cardsDone: completion.cardsDone,
    lessonsDone: completion.lessonsDone,
    conversation: conversationCredit(db, completion.localDay).met,
  };
}
