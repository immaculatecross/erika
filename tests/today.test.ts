import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { buildToday } from "@/lib/today";
import { openSession, markStepDone } from "@/lib/session/store";
import { completeDayIfMet } from "@/lib/session/day";
import { localDay } from "@/lib/local-day";

// The Learn home read-model (E-31, rewritten at E-44). One screen, one action: the
// ring, the one factual line, the streak, and a single control.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-today-"));
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

/** Mark the learner placed (E-35): `placementStatus` is true once the evidence log
 *  carries any `source:'placement'` row. Without it the one control is "Find your
 *  level", which is its own test below. */
function place(db: Db): void {
  db.prepare(
    "INSERT INTO evidence (id, item_id, source, source_ref, polarity, mode, weight) " +
      "VALUES ('e1', 'rule:alfabeto-suoni', 'placement', 'placement:r1', 1, 'recognition', 0.3)",
  ).run();
}

/** E-43's v29 record of a conversation that met its minimum on `day`. */
function creditConversation(db: Db, day: string): void {
  db.prepare(
    "INSERT INTO tutor_conversations (id, min_seconds, met_minimum, ended_at, local_day) " +
      "VALUES ('t1', 600, 1, datetime('now'), ?)",
  ).run(day);
}

describe("buildToday", () => {
  it("offers a real day on a fresh database — never an empty state (D-27)", () => {
    const db = freshDb();
    place(db);
    const view = buildToday(db, "2026-07-25");

    expect(view.steps.length).toBeGreaterThan(0);
    expect(view.goal.total).toBe(view.steps.length);
    expect(view.goal.done).toBe(0);
    expect(view.complete).toBe(false);
    expect(view.summary).toContain("A lesson on");
    expect(view.action.kind).toBe("start");
    db.close();
  });

  it("switches the one control to Continue once the session is open", () => {
    const db = freshDb();
    place(db);
    const day = localDay();
    expect(buildToday(db, day).action.kind).toBe("start");
    openSession(db, day);
    expect(buildToday(db, day).action.kind).toBe("continue");
    db.close();
  });

  it("closes the ring, states the figures once, and offers no control at all", () => {
    const db = freshDb();
    place(db);
    const day = localDay();
    const session = openSession(db, day);
    // The conversation step is verified against E-43's durable record, so the only way
    // to close the ring is for a conversation to have genuinely met its minimum.
    creditConversation(db, day);
    for (const step of session.steps) markStepDone(db, day, step);
    completeDayIfMet(db, day);

    const view = buildToday(db, day);
    expect(view.complete).toBe(true);
    expect(view.goal.done).toBe(view.goal.total);
    expect(view.completion).toEqual({ cardsDone: 0, lessonsDone: 1, conversation: true });
    expect(view.action).toEqual({ kind: "none" });
    db.close();
  });

  it("asks an unplaced learner for their level instead — still one control", () => {
    const db = freshDb();
    const view = buildToday(db, localDay());
    expect(view.placed).toBe(false);
    expect(view.action).toEqual({
      kind: "place",
      href: "/practice/placement",
      label: "Find your level",
    });
    db.close();
  });
});
