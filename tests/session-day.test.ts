import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { completedDayCount, getDayCompletion, recordDayComplete } from "@/lib/day-ledger";
import { completeDayIfMet, completionFigures, dayFigures, dayGoal } from "@/lib/session/day";
import { getSession, markStepDone, openSession, reconcileSession } from "@/lib/session/store";
import { buildSessionView } from "@/lib/session/view";
import { buildStreak } from "@/lib/streak/store";
import { localDay } from "@/lib/local-day";

// CRITERION 4 — the day is complete when the SESSION is (E-44, D-26).
//
// The defect this replaces: the goal counted flashcards alone, and `completeDayIfMet`
// wrote `lessonsDone: 0` as a hard-coded literal. So a learner could read a lesson and
// hold a ten-minute Italian conversation and the day counted for nothing — which is
// the mechanical reason everything the plan offered read as optional.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-session-day-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

let keyBefore: string | undefined;
beforeEach(() => {
  keyBefore = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-key";
});
afterEach(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
});

function createConversationRecord(db: Db): void {
  db.exec(`
    CREATE TABLE tutor_conversations (
      id TEXT PRIMARY KEY, started_at TEXT, ended_at TEXT, duration_seconds REAL,
      min_seconds INTEGER NOT NULL, met_minimum INTEGER NOT NULL DEFAULT 0,
      session_id TEXT, local_day TEXT
    );
  `);
}

function creditConversation(db: Db, day: string, met: boolean): void {
  db.prepare(
    "INSERT INTO tutor_conversations (id, min_seconds, met_minimum, ended_at, local_day) VALUES (?, 600, ?, datetime('now'), ?)",
  ).run(`t-${day}-${met}`, met ? 1 : 0, day);
}

describe("the day's goal is the session, not the card queue", () => {
  it("counts steps, and is not met until every one is done", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    expect(session.steps.length).toBeGreaterThan(0);

    const before = dayGoal(db, day);
    expect(before.total).toBe(session.steps.length);
    expect(before.done).toBe(0);
    expect(before.met).toBe(false);

    for (const step of session.steps) markStepDone(db, day, step);
    const after = dayGoal(db, day);
    expect(after.done).toBe(after.total);
    expect(after.met).toBe(true);
    db.close();
  });

  it("does NOT complete the day on cards alone any more", () => {
    // The regression that matters: clearing the queue used to BE the day. Now it is
    // one step of it, and the day stays open until the rest is done.
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    expect(session.steps).toContain("drills");

    markStepDone(db, day, "drills");
    expect(dayGoal(db, day).met).toBe(false);
    expect(completeDayIfMet(db, day)).toBeNull();
    expect(completedDayCount(db)).toBe(0);
    db.close();
  });

  it("records real figures — the lessonsDone: 0 literal is gone", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    for (const step of session.steps) markStepDone(db, day, step);

    const completion = completeDayIfMet(db, day)!;
    expect(completion.lessonsDone).toBe(1);
    expect(dayFigures(db, day).lessonsDone).toBe(1);
    db.close();
  });

  it("is idempotent: a second call returns the first row unchanged", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    for (const step of session.steps) markStepDone(db, day, step);

    const first = completeDayIfMet(db, day)!;
    const second = completeDayIfMet(db, day)!;
    expect(second.completedAt).toBe(first.completedAt);
    expect(completedDayCount(db)).toBe(1);
    db.close();
  });
});

describe("the conversation counts only when the minimum was met (the operator's rule)", () => {
  it("leaves the step open while the conversation fell short", () => {
    const db = freshDb();
    createConversationRecord(db);
    const day = localDay();
    const session = openSession(db, day);
    expect(session.steps).toContain("conversation");

    creditConversation(db, day, false);
    markStepDone(db, day, "conversation");
    expect(getSession(db, day)!.doneSteps).not.toContain("conversation");
    expect(dayGoal(db, day).met).toBe(false);
    db.close();
  });

  it("credits it — without any client claim — once the minimum was met", () => {
    const db = freshDb();
    createConversationRecord(db);
    const day = localDay();
    const session = openSession(db, day);
    for (const step of session.steps) {
      if (step !== "conversation") markStepDone(db, day, step);
    }
    expect(dayGoal(db, day).met).toBe(false);

    // Nothing POSTs a step: the learner simply had the conversation. The durable
    // record moves, and reconciliation folds it in.
    creditConversation(db, day, true);
    const reconciled = reconcileSession(db, day)!;
    expect(reconciled.doneSteps).toContain("conversation");
    expect(dayGoal(db, day).met).toBe(true);

    const completion = completeDayIfMet(db, day)!;
    expect(completionFigures(db, completion).conversation).toBe(true);
    db.close();
  });
});

describe("the day is recorded wherever the session is observed complete", () => {
  it("records it when the LAST step completes by observation, with no step ever POSTed", () => {
    // Found by driving the built server. The conversation is the last step and the
    // only one that completes by observation — the learner has it on the tutor page
    // and nothing posts a step. The session read complete while `day_ledger` stayed
    // EMPTY: no completion sentence, no closed ring, no streak day, for a learner who
    // finished their day exactly as designed.
    const db = freshDb();
    createConversationRecord(db);
    const day = localDay();
    const session = openSession(db, day);
    expect(session.steps[session.steps.length - 1]).toBe("conversation");
    for (const step of session.steps) {
      if (step !== "conversation") markStepDone(db, day, step);
    }
    expect(getDayCompletion(db, day)).toBeNull();

    creditConversation(db, day, true);
    // A plain READ of the session — exactly what the home and the runner do.
    const view = buildSessionView(db, day);
    expect(view.complete).toBe(true);

    const completion = getDayCompletion(db, day);
    expect(completion).not.toBeNull();
    expect(completion!.lessonsDone).toBe(1);
    expect(completedDayCount(db)).toBe(1);
    db.close();
  });

  it("does not record a day whose session is unfinished, however often it is read", () => {
    const db = freshDb();
    createConversationRecord(db);
    const day = localDay();
    const session = openSession(db, day);
    markStepDone(db, day, session.steps[0]);
    for (let i = 0; i < 3; i++) buildSessionView(db, day);
    expect(getDayCompletion(db, day)).toBeNull();
    expect(completedDayCount(db)).toBe(0);
    db.close();
  });
});

describe("recorded history is never rewritten", () => {
  it("leaves a day recorded under the old rule exactly as it was", () => {
    const db = freshDb();
    // A day the OLD cards-only rule completed, with its own figures.
    recordDayComplete(db, "2026-07-20", { cardsDone: 9, lessonsDone: 0 });
    const before = getDayCompletion(db, "2026-07-20")!;

    // Living through the new rule today changes nothing about it.
    const today = localDay();
    const session = openSession(db, today);
    for (const step of session.steps) markStepDone(db, today, step);
    completeDayIfMet(db, today);

    expect(getDayCompletion(db, "2026-07-20")).toEqual(before);
    db.close();
  });

  it("keeps the streak reading the same ledger it always did", () => {
    // `lib/streak/` reads only `local_day`; what earns the row is E-44's business and
    // none of its own. A run built under the old rule survives the change intact.
    const db = freshDb();
    for (const d of ["2026-07-21", "2026-07-22", "2026-07-23"]) {
      recordDayComplete(db, d, { cardsDone: 4, lessonsDone: 0 });
    }
    expect(buildStreak(db, "2026-07-23").currentRun).toBe(3);
    db.close();
  });
});
