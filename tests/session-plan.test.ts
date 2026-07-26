import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { planSession, textModelReachable } from "@/lib/session/plan";
import { syllabusFallback } from "@/lib/session/view";
import { itemLessonKind } from "@/lib/lessons/item-lessons";
import { describeSession } from "@/lib/session/steps";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";

// The session PLANNER (E-44). Two criteria live or die here.
//
// CRITERION 10 (D-27) is the primary path and the first block below: a learner who has
// never recorded anything opens the app and gets a FULL session, drawn from E-26's
// syllabus at their knowledge edge — not an empty state, not a prompt to go record
// something, not a shortened day.
//
// CRITERION 3 is the rest: a step that cannot run is ABSENT with a reason, never a row
// that refuses. The reasons are asserted here; the copy rules are in
// tests/session-notices.test.ts.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-session-plan-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

let keyBefore: string | undefined;
beforeEach(() => {
  keyBefore = process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (keyBefore === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = keyBefore;
});

function setBudget(db: Db, usd: number): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('monthlyBudgetUsd', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(String(usd));
}

/** E-43's v29 `tutor_conversations` now ships on master, so every `freshDb()` has it.
 *  Dropping it is how we still exercise the planner's capability probe
 *  (`conversationRecordAvailable`) — a build that cannot observe a conversation must
 *  not ask for one. */
function dropConversationRecord(db: Db): void {
  db.exec("DROP TABLE tutor_conversations;");
}

/** One fully analysed session with one finding — the recordings OVERLAY (D-27),
 *  which `generateCards` turns into a card the drills step serves. Built through the
 *  real writers so it passes the E-17 included-finding gate rather than around it. */
function seedFinding(db: Db, id: string): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 60_000, contentHash: `${id}-h0` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h0`,
    flagged: true,
    deepDone: true,
    findings: [
      {
        quote: "ho andato",
        correction: "sono andato",
        category: "grammar",
        explanation: "why",
        severity: "medium",
        startMs: 0,
        endMs: 500,
      },
    ],
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = 'done', progress = 1 WHERE id = ?").run(job.id);
}

describe("CRITERION 10 — a day with nothing recorded is a complete day (D-27)", () => {
  it("plans a full session on a database with zero sessions and zero findings", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM findings").get()).toEqual({ n: 0 });

    const plan = planSession(db, "2026-07-25");

    // The backbone is the syllabus, so the day exists without a single recording.
    expect(plan.steps).toContain("lesson");
    expect(plan.steps).toContain("drills");
    expect(plan.lessonItemId).not.toBeNull();
    expect(plan.lessonLabel).not.toBeNull();
    expect(plan.plannedCards).toBe(0);

    // And the learner is told what today holds as a positive statement of a real day.
    const sentence = describeSession({
      steps: plan.steps,
      lessonLabel: plan.lessonLabel,
      cards: plan.plannedCards,
    });
    expect(sentence).toContain("A lesson on");
    expect(sentence.toLowerCase()).not.toContain("nothing");
    db.close();
  });

  it("draws that lesson from the 266-rule syllabus, with its authored content", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    const plan = planSession(db, "2026-07-25");

    expect(itemLessonKind(plan.lessonItemId!)).toBe("grammar");
    const fallback = syllabusFallback(plan.lessonItemId);
    expect(fallback).not.toBeNull();
    expect(fallback!.title.length).toBeGreaterThan(0);
    expect(fallback!.description.length).toBeGreaterThan(40);
    expect(fallback!.examples.length).toBeGreaterThan(0);
    expect(["A1", "A2", "B1", "B2", "C1", "C2"]).toContain(fallback!.cefr);
    db.close();
  });

  it("weaves the recordings in WITHOUT the day depending on them", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    const without = planSession(db, "2026-07-25");

    seedFinding(db, "f1");
    seedFinding(db, "f2");
    const withRecordings = planSession(db, "2026-07-25");

    // The teaching steps are the SAME either way — the recordings do not create the
    // day, they ride in it. What they add is cards (criterion 9: an unspent finding
    // reaches the learner as a card in the drills step) and, once a week, the letter.
    expect(without.steps).toContain("lesson");
    expect(without.steps).toContain("drills");
    expect(withRecordings.steps).toContain("lesson");
    expect(withRecordings.steps).toContain("drills");
    expect(without.lessonItemId).toBe(withRecordings.lessonItemId);
    expect(without.plannedCards).toBe(0);
    expect(withRecordings.plannedCards).toBe(2);
    db.close();
  });
});

describe("CRITERION 3 — a step that cannot run is absent, with a reason", () => {
  it("keeps the lesson keyless, because a syllabus rule needs no model at all", () => {
    delete process.env.OPENAI_API_KEY;
    const db = freshDb();
    const plan = planSession(db, "2026-07-25");

    expect(plan.steps).toContain("lesson");
    expect(syllabusFallback(plan.lessonItemId)).not.toBeNull();
    db.close();
  });

  it("drops the drills step keyless with nothing to drill, naming the key", () => {
    delete process.env.OPENAI_API_KEY;
    const db = freshDb();
    const plan = planSession(db, "2026-07-25");

    expect(plan.steps).not.toContain("drills");
    expect(plan.omitted).toContainEqual({ key: "drills", reason: "no-key" });
    db.close();
  });

  it("keeps the drills step keyless when there ARE cards — they need no model", () => {
    delete process.env.OPENAI_API_KEY;
    const db = freshDb();
    seedFinding(db, "f1");
    const plan = planSession(db, "2026-07-25");

    expect(plan.steps).toContain("drills");
    expect(plan.plannedCards).toBe(1);
    db.close();
  });

  it("names the budget, not the key, when the cap is what refuses", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    setBudget(db, 0);
    expect(textModelReachable(db)).toEqual({ ok: false, reason: "budget" });

    const plan = planSession(db, "2026-07-25");
    expect(plan.steps).toContain("lesson"); // still teachable from the syllabus
    expect(plan.omitted).toContainEqual({ key: "drills", reason: "budget" });
    expect(plan.omitted).toContainEqual({ key: "conversation", reason: "budget" });
    db.close();
  });

  it("offers no conversation step on a build that cannot record one", () => {
    // With E-43's v29 dropped, the day cannot observe whether a conversation happened,
    // so it must not ask for one.
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    dropConversationRecord(db);
    const plan = planSession(db, "2026-07-25");

    expect(plan.steps).not.toContain("conversation");
    expect(plan.omitted).toContainEqual({ key: "conversation", reason: "not-recorded" });
    db.close();
  });

  it("offers it as soon as E-43's record exists and a call is possible", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    const plan = planSession(db, "2026-07-25");

    expect(plan.steps).toEqual(["lesson", "drills", "conversation"]);
    expect(plan.omitted).toEqual([]);
    db.close();
  });

  it("keeps a conversation already credited today even at the cap", () => {
    // Dropping it would silently un-do work the learner has genuinely done.
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    setBudget(db, 0);
    db.prepare(
      "INSERT INTO tutor_conversations (id, min_seconds, met_minimum, ended_at, local_day) VALUES ('t1', 600, 1, datetime('now'), '2026-07-25')",
    ).run();

    const plan = planSession(db, "2026-07-25");
    expect(plan.steps).toContain("conversation");
    db.close();
  });
});

describe("the letter is a step only in the week it is unread", () => {
  it("is absent with nothing analyzed", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    expect(planSession(db, "2026-07-25").steps).not.toContain("letter");
    db.close();
  });

  it("appears once a letter exists and has not been opened", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    seedFinding(db, "f1");
    const plan = planSession(db);
    expect(plan.letterWeek).not.toBeNull();
    expect(plan.steps).toContain("letter");
    db.close();
  });

  it("leaves the session once it has been read (the E-24 marker, untouched)", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const db = freshDb();
    seedFinding(db, "f1");
    const week = planSession(db).letterWeek!;
    db.prepare("INSERT INTO settings (key, value) VALUES ('letterViewedWeek', ?)").run(week);
    expect(planSession(db).steps).not.toContain("letter");
    db.close();
  });
});
