import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  currentStep,
  getSession,
  isSessionComplete,
  markStepDone,
  openSession,
} from "@/lib/session/store";
import { buildSessionView } from "@/lib/session/view";
import { localDay } from "@/lib/local-day";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { generateCards, listDueCards, gradeCard } from "@/lib/cards";

// CRITERION 2 — a linear, RESUMABLE session (E-44, migration v30).
//
// The resume point is a durable fact, not React state: the step to show is whatever
// the server says is the first one not yet done. And the day's plan is FROZEN at open,
// because every input the planner reads moves while the learner works — answering an
// exercise writes evidence, grading a card empties the queue, an ingest finishing
// mints new cards. A session recomputed on every read would shift under their feet.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-session-store-"));
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

function seedFinding(db: Db, id: string): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 60_000, contentHash: `${id}-h0` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h0`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: "q", correction: "c", category: "grammar", explanation: "why", severity: "medium", startMs: 0, endMs: 1 },
    ],
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = 'done', progress = 1 WHERE id = ?").run(job.id);
}

describe("opening a session", () => {
  it("is idempotent — two Starts open ONE day, and the second re-plans nothing", () => {
    const db = freshDb();
    const day = localDay();
    const first = openSession(db, day);
    const second = openSession(db, day);
    expect(second.startedAt).toBe(first.startedAt);
    expect(second.steps).toEqual(first.steps);
    expect(db.prepare("SELECT COUNT(*) AS n FROM daily_sessions").get()).toEqual({ n: 1 });
    db.close();
  });

  it("freezes the plan: work done DURING the session cannot change the day", () => {
    const db = freshDb();
    seedFinding(db, "s1");
    const day = localDay();
    const opened = openSession(db, day);
    expect(opened.plannedCards).toBe(1);

    // A recording lands mid-session and mints another card. Today's bar does not move.
    seedFinding(db, "s2");
    generateCards(db);
    expect(getSession(db, day)!.plannedCards).toBe(1);
    expect(getSession(db, day)!.steps).toEqual(opened.steps);
    db.close();
  });
});

describe("resuming", () => {
  it("returns to the first step not yet done, across a reload", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    expect(currentStep(session)).toBe(session.steps[0]);

    markStepDone(db, day, session.steps[0]);
    // A "reload": a brand-new read of the same durable row.
    const resumed = getSession(db, day)!;
    expect(currentStep(resumed)).toBe(session.steps[1] ?? null);
    expect(buildSessionView(db, day).step).toBe(session.steps[1] ?? null);
    db.close();
  });

  it("is a SET, so a double-tap or a retried POST cannot advance twice", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    markStepDone(db, day, session.steps[0]);
    markStepDone(db, day, session.steps[0]);
    expect(getSession(db, day)!.doneSteps).toEqual([session.steps[0]]);
    db.close();
  });

  it("refuses a step that is not part of today's session", () => {
    const db = freshDb();
    const day = localDay();
    openSession(db, day); // no conversation step: E-43's record is absent here
    markStepDone(db, day, "conversation");
    expect(getSession(db, day)!.doneSteps).not.toContain("conversation");
    db.close();
  });

  it("marks the session ended only when the last step lands", () => {
    const db = freshDb();
    const day = localDay();
    const session = openSession(db, day);
    for (const step of session.steps.slice(0, -1)) markStepDone(db, day, step);
    expect(getSession(db, day)!.endedAt).toBeNull();
    expect(isSessionComplete(getSession(db, day))).toBe(false);

    markStepDone(db, day, session.steps[session.steps.length - 1]);
    expect(getSession(db, day)!.endedAt).not.toBeNull();
    expect(isSessionComplete(getSession(db, day))).toBe(true);
    db.close();
  });
});

describe("the drills step is verified against card state, not the client's word", () => {
  it("stays open while the planned cards are unreviewed", () => {
    const db = freshDb();
    seedFinding(db, "s1");
    const day = localDay();
    const session = openSession(db, day);
    expect(session.plannedCards).toBe(1);

    markStepDone(db, day, "drills");
    expect(getSession(db, day)!.doneSteps).not.toContain("drills");
    db.close();
  });

  it("completes once they are reviewed", () => {
    const db = freshDb();
    seedFinding(db, "s1");
    const day = localDay();
    openSession(db, day);
    for (const card of listDueCards(db)) gradeCard(db, card.id, "good");

    markStepDone(db, day, "drills");
    expect(getSession(db, day)!.doneSteps).toContain("drills");
    db.close();
  });
});

describe("a corrupt row degrades rather than crashing", () => {
  it("reads an unparseable step list as no steps at all", () => {
    const db = freshDb();
    const day = localDay();
    openSession(db, day);
    db.prepare("UPDATE daily_sessions SET steps = 'not json' WHERE local_day = ?").run(day);
    const session = getSession(db, day)!;
    expect(session.steps).toEqual([]);
    expect(isSessionComplete(session)).toBe(false);
    db.close();
  });
});
