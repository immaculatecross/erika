import type { Db } from "../db";
import { localDay } from "../local-day";
import { cardsReviewedToday } from "../day-ledger";
import { getViewedLetterWeek } from "../plan";
import { collectLetterSessions, latestWeekWithFindings } from "../letter";
import { conversationCredit } from "./conversation-credit";
import { orderSteps, type StepKey } from "./steps";
import { planSession, type SessionPlan } from "./plan";

// The day's session, stored (E-44, migration v30). One row per local day, opened when
// the learner presses Start and never re-planned after that — see the migration for
// why freezing is the load-bearing part.
//
// A step is done when its key is in `done_steps`, which is a SET: `markStepDone` is
// idempotent, so a double-tap, a refresh, a retried POST and a back-button revisit all
// converge on the same day. There is no counter anywhere here to inflate.
//
// WHAT THE SERVER VERIFIES, AND WHAT IT DOES NOT — stated plainly because the
// asymmetry is deliberate and a reader will otherwise assume it is an oversight:
//
//   · `conversation` is verified against E-43's durable record and CANNOT be marked
//     done by the client at all. That is criterion 4's rule, and the one place where
//     a false claim would corrupt the streak.
//   · `letter` is verified against the E-24 viewed marker.
//   · `drills` is verified against card state: as many distinct cards reviewed today
//     as the session planned. Cards minted mid-session cannot un-complete it, because
//     the bar was frozen at open.
//   · `lesson` is NOT verifiable and is taken on the client's word. Reading an
//     explanation leaves no durable trace, and the one trace that exists — the cued
//     evidence an exercise writes — is absent from exactly the case that matters most
//     (the degraded, model-free rule lesson has no exercises). Demanding evidence
//     there would make the keyless lesson uncompletable: a gate that fires precisely
//     when the learner did nothing wrong. So it is a self-report, and the figures the
//     ledger actually records stay derived from durable state either way.

export interface DailySession {
  localDay: string;
  startedAt: string;
  endedAt: string | null;
  steps: StepKey[];
  doneSteps: StepKey[];
  lessonItemId: string | null;
  plannedCards: number;
}

interface Row {
  local_day: string;
  started_at: string;
  ended_at: string | null;
  steps: string;
  done_steps: string;
  lesson_item_id: string | null;
  planned_cards: number;
}

function parseSteps(json: string): StepKey[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? orderSteps(parsed) : [];
  } catch {
    return [];
  }
}

function toSession(r: Row): DailySession {
  return {
    localDay: r.local_day,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    steps: parseSteps(r.steps),
    doneSteps: parseSteps(r.done_steps),
    lessonItemId: r.lesson_item_id,
    plannedCards: r.planned_cards,
  };
}

/** Today's session row, or null when the learner has not started today. */
export function getSession(db: Db, day: string = localDay()): DailySession | null {
  const r = db.prepare("SELECT * FROM daily_sessions WHERE local_day = ?").get(day) as Row | undefined;
  return r ? toSession(r) : null;
}

/**
 * Open today's session, freezing the plan. IDEMPOTENT via the `local_day` PK +
 * INSERT OR IGNORE: pressing Start twice, or two tabs racing, returns the SAME
 * session — the second call plans nothing and changes nothing. A day can never be
 * re-planned once begun.
 */
export function openSession(db: Db, day: string = localDay(), plan?: SessionPlan): DailySession {
  const existing = getSession(db, day);
  if (existing) return existing;
  const p = plan ?? planSession(db, day);
  db.prepare(
    "INSERT OR IGNORE INTO daily_sessions (local_day, steps, lesson_item_id, planned_cards) VALUES (?, ?, ?, ?)",
  ).run(day, JSON.stringify(p.steps), p.lessonItemId, p.plannedCards);
  return getSession(db, day)!;
}

/** Does the durable state agree that `step` is finished? Null = nothing to check
 *  (a self-reported step). */
function verifyStep(db: Db, session: DailySession, step: StepKey): boolean | null {
  if (step === "conversation") return conversationCredit(db, session.localDay).met;
  if (step === "drills") return cardsReviewedToday(db, session.localDay) >= session.plannedCards;
  if (step === "letter") {
    // The E-24 contract, unchanged: the forward-only `letterViewedWeek` marker must
    // have reached THIS week. Recomputed rather than frozen because it is the same
    // one-line derivation the planner made, and a week cannot move backwards.
    const week = latestWeekWithFindings(collectLetterSessions(db));
    const viewed = getViewedLetterWeek(db);
    return week !== null && viewed !== null && viewed >= week;
  }
  return null;
}

/**
 * Mark a step done. Returns the session, or null when there is no session today.
 *
 * A step with a server-side check is written ONLY when that check passes, so the
 * client cannot claim a step it did not finish. A step the check refuses is silently
 * left undone — the runner re-reads the session and shows it as still open, which is
 * the truthful outcome and never a claimed success (the mirror-image failure the
 * verification brief asks about: a step that claims success it did not achieve).
 */
export function markStepDone(db: Db, day: string, step: StepKey): DailySession | null {
  const session = getSession(db, day);
  if (!session) return null;
  if (!session.steps.includes(step)) return session;
  if (session.doneSteps.includes(step)) return session;
  if (verifyStep(db, session, step) === false) return session;

  const doneSteps = orderSteps([...session.doneSteps, step]);
  const complete = doneSteps.length === session.steps.length;
  db.prepare(
    "UPDATE daily_sessions SET done_steps = ?, ended_at = CASE WHEN ? = 1 THEN datetime('now') ELSE ended_at END " +
      "WHERE local_day = ?",
  ).run(JSON.stringify(doneSteps), complete ? 1 : 0, day);
  return getSession(db, day);
}

/**
 * Re-read the steps whose truth lives elsewhere and fold them in. The conversation is
 * the case this exists for: the learner leaves for the tutor page, has the
 * conversation, and comes back — nothing POSTed a step, but the day genuinely moved.
 * Idempotent, and it can only ever ADD (a step already recorded is never withdrawn,
 * because recorded history is not rewritten).
 */
export function reconcileSession(db: Db, day: string = localDay()): DailySession | null {
  const session = getSession(db, day);
  if (!session) return null;
  let current = session;
  for (const step of current.steps) {
    if (current.doneSteps.includes(step)) continue;
    if (verifyStep(db, current, step) === true) {
      current = markStepDone(db, day, step) ?? current;
    }
  }
  return current;
}

/** Every step done — the day's session is finished. An empty session is not
 *  complete: a day with nothing in it was never done, it was never offered. */
export function isSessionComplete(session: DailySession | null): boolean {
  if (!session || session.steps.length === 0) return false;
  return session.steps.every((s) => session.doneSteps.includes(s));
}

/** The step the learner is on: the first one not yet done, or null when finished. */
export function currentStep(session: DailySession | null): StepKey | null {
  if (!session) return null;
  return session.steps.find((s) => !session.doneSteps.includes(s)) ?? null;
}
