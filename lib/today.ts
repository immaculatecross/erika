import type { Db } from "./db";
import { buildPlan, type PlanLesson } from "./plan";
import { compose, capsFromSettings } from "./compose";
import { dayGoal, getDayCompletion } from "./day-ledger";
import { localDay } from "./local-day";
import { placementStatus } from "./placement/status";
import { buildStreak, type StreakView } from "./streak/store";
import { buildKnowledgeMap, type MapCell } from "./knowledge-map";
import { buildTodayThread, type TodayThread } from "./today-thread";

// The Learn TODAY read-model (E-31, D-24). Composes today's plan (draining the spill
// queue, writing tomorrow's overflow — the composer's only, idempotent side effect,
// the same read-path materialization precedent as slips), then reduces it to what
// the calm Learn home shows: the goal ring, the factual completion state, the
// review row, the one lesson row, and the composer's new-item counts. ZERO model
// calls. The tutor row arrives with E-34 (its slot is left in the UI).
//
// The completion sentence is one per day (D-24): it is shown only once the day's
// goal is met, from the ledger's stored figures. The ledger WRITE happens in the
// POST /api/day/complete route (a GET must not record a user-visible fact); this
// read only reports whether today is already recorded.

export interface TodayView {
  /** The local day this plan is for ("YYYY-MM-DD"). */
  day: string;
  /** Goal ring: cards done today over the day's total card workload. */
  goal: { done: number; total: number };
  /** True once today's goal-completion row exists. */
  complete: boolean;
  /** The figures the one-per-day completion sentence states, or null. */
  completion: { cardsDone: number; lessonsDone: number } | null;
  /** Cards still due right now. */
  dueCount: number;
  /** The one lesson the ranking prescribes next (E-18, reused), or null. */
  lesson: PlanLesson | null;
  /** This week's letter is waiting and unread. */
  letterUnread: boolean;
  /** New items the composer queued at the knowledge edge for today, per kind. */
  newItems: { vocab: number; rules: number; pronunciation: number };
  /** Has the learner run placement yet? False → the Learn first-run entry shows a
   *  calm prompt to find their level (E-35), so the composer isn't guessing A1. */
  placed: boolean;
  /** The calm habit layer (E-38, D-24): the consecutive-day run and the repairs it
   *  stands on. A zero run renders nothing — never a nag, never a warning. */
  streak: StreakView;
  /** The map strip (E-38): one cell per category, green ONLY via resolved slips. */
  map: MapCell[];
  /** One factual beat tying today's plan to what the learner actually said today,
   *  or null — in which case the surface shows NOTHING (E-38, D-19). */
  thread: TodayThread | null;
}

export function buildToday(db: Db, day: string = localDay()): TodayView {
  const plan = compose(db, day, capsFromSettings(db));
  const goal = dayGoal(db, day);
  const completion = getDayCompletion(db, day);
  const base = buildPlan(db); // reuse the E-18 lesson prescription + letter state

  return {
    day,
    goal: { done: goal.done, total: goal.total },
    complete: completion !== null,
    completion: completion ? { cardsDone: completion.cardsDone, lessonsDone: completion.lessonsDone } : null,
    dueCount: goal.dueRemaining,
    lesson: base.lesson,
    letterUnread: base.letterUnread,
    newItems: {
      vocab: plan.counts.vocab,
      rules: plan.counts.rule,
      pronunciation: plan.counts.pronunciation,
    },
    placed: placementStatus(db).placed,
    streak: buildStreak(db, day),
    map: buildKnowledgeMap(db),
    // Today's targets are the composed plan's own item ids — reusing the plan
    // already computed above rather than re-composing (`collectTutorTargets` does
    // the same reduction for the tutor persona, bounded to 8; the beat wants the
    // whole day's plan, so it reduces the plan directly).
    thread: buildTodayThread(
      db,
      day,
      plan.items.map((i) => i.itemId).filter((id): id is string => !!id),
    ),
  };
}
