import type { Db } from "./db";
import { localDay } from "./local-day";
import { getDayCompletion } from "./day-ledger";
import { placementStatus } from "./placement/status";
import { buildStreak, type StreakView } from "./streak/store";
import { buildTodayThread, type TodayThread } from "./today-thread";
import { compose, capsFromSettings } from "./compose";
import { completionFigures, dayGoal } from "./session/day";
import { buildSessionView } from "./session/view";
import { homeAction, type DayFigures, type HomeAction, type StepKey } from "./session/steps";
import type { LessonPreparationState } from "./lessons/item-lessons";

// The Learn home read-model (E-44, D-24/D-26). ONE SCREEN, ONE ACTION.
//
// What this replaces: seven sections and up to thirteen actionable rows over four to
// six destinations. The home now carries the ring, the streak line, one factual line
// saying what today holds, and exactly one control — Start today / Continue / nothing
// at all once the day is done. Everything else moved behind the Library entry in the
// header, which is chrome and not a plan item.
//
// The composer still runs here, and still makes ZERO model calls: `buildSessionView`
// plans the day through it, which keeps its spill-queue reconciliation on the read
// path exactly where E-31 put it.

export interface TodayView {
  /** The local day this plan is for ("YYYY-MM-DD"). */
  day: string;
  /** Goal ring: steps finished over the steps today's session holds. */
  goal: { done: number; total: number };
  /** True once today's goal-completion row exists. */
  complete: boolean;
  /** The figures the one-per-day completion sentence states, or null. */
  completion: DayFigures | null;
  /** The one factual line describing what today holds. */
  summary: string;
  /** The steps today's session holds — for the caller that wants to name them. */
  steps: StepKey[];
  /** The ONE primary control. There is never a second. */
  action: HomeAction;
  /** Today's selected lesson must be ready before Start can open the session. */
  lessonPreparation: LessonPreparationState;
  /** Has the learner run placement yet (E-35)? Decides what the one control says. */
  placed: boolean;
  /** The calm habit layer (E-38, D-24): a zero run renders nothing — never a nag. */
  streak: StreakView;
  /** One factual beat tying today's plan to what the learner actually said today, or
   *  null — in which case the surface shows NOTHING (E-38, D-19). */
  thread: TodayThread | null;
}

export function buildToday(db: Db, day: string = localDay()): TodayView {
  const view = buildSessionView(db, day);
  const goal = dayGoal(db, day);
  const completion = getDayCompletion(db, day);
  const placed = placementStatus(db).placed;

  // Today's targets for the thread beat are the composed plan's own item ids. The
  // composer has already run inside `buildSessionView`; this second call is
  // idempotent within the day (E-31) and keeps the beat reading the whole plan rather
  // than the session's single lesson item.
  const plan = compose(db, day, capsFromSettings(db));

  return {
    day,
    goal: { done: goal.done, total: goal.total },
    complete: completion !== null,
    completion: completion ? completionFigures(db, completion) : null,
    summary: view.summary,
    steps: view.steps,
    action: homeAction({
      placed,
      started: view.started,
      complete: completion !== null,
      hasSteps: view.steps.length > 0,
    }),
    lessonPreparation: view.lesson?.preparation ?? "ready",
    placed,
    streak: buildStreak(db, day),
    thread: buildTodayThread(
      db,
      day,
      plan.items.map((i) => i.itemId).filter((id): id is string => !!id),
    ),
  };
}
