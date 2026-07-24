import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { localDay, nextLocalDay, isLocalDay } from "@/lib/local-day";
import {
  cardsReviewedToday,
  completeDayIfMet,
  completedDayCount,
  dayGoal,
  getDayCompletion,
  isDayComplete,
  recordDayComplete,
} from "@/lib/day-ledger";

// The local-day goal-completion ledger (E-31, D-24) and its local-day basis.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-ledger-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Insert a session + finding + card directly (bypassing the pipeline) so the
 *  ledger's card-derived goal can be exercised in isolation. */
function seedCard(
  db: Db,
  id: string,
  over: { intervalDays: number; due: string; lastGrade: string | null; suspended?: number },
): void {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, original_filename, format, size_bytes, duration_seconds) VALUES ('s1','t.wav','wav',1,60)",
  ).run();
  db.prepare(
    `INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
     VALUES (?, 's1', ?, 'q', 'c', 'grammar', 'why', 'low', 0, 1)`,
  ).run(`f-${id}`, `h-${id}`);
  db.prepare(
    `INSERT INTO cards (id, finding_id, session_id, front, back, category, start_ms, ease, interval_days, repetitions, due, last_grade, suspended)
     VALUES (?, ?, 's1', 'fr', 'bk', 'grammar', 0, 2.5, ?, 1, ?, ?, ?)`,
  ).run(id, `f-${id}`, over.intervalDays, over.due, over.lastGrade, over.suspended ?? 0);
}

describe("local-day basis (D-24 timezone stance)", () => {
  it("reduces a Date to its LOCAL calendar day", () => {
    expect(localDay(new Date(2026, 0, 31, 23, 59, 0))).toBe("2026-01-31");
    expect(localDay(new Date(2026, 2, 1, 0, 0, 0))).toBe("2026-03-01");
    expect(isLocalDay("2026-07-24")).toBe(true);
    expect(isLocalDay("2026-7-4")).toBe(false);
  });

  it("advances to the next local day across month and year boundaries", () => {
    expect(nextLocalDay("2026-01-31")).toBe("2026-02-01"); // month
    expect(nextLocalDay("2026-02-28")).toBe("2026-03-01"); // non-leap Feb
    expect(nextLocalDay("2026-12-31")).toBe("2027-01-01"); // year
  });

  it("puts two instants straddling local midnight on two different days", () => {
    const beforeMidnight = new Date(2026, 5, 30, 23, 59, 30);
    const afterMidnight = new Date(2026, 6, 1, 0, 0, 30);
    expect(localDay(beforeMidnight)).toBe("2026-06-30");
    expect(localDay(afterMidnight)).toBe("2026-07-01");
    expect(nextLocalDay(localDay(beforeMidnight))).toBe(localDay(afterMidnight));
  });
});

describe("cardsReviewedToday (derived, no new column)", () => {
  it("counts a card whose last review reduces to the target local day, and no other day", () => {
    const db = freshDb();
    const due = "2026-07-24 15:00:00"; // UTC; reviewed 3 days earlier
    seedCard(db, "c1", { intervalDays: 3, due, lastGrade: "good" });
    const reviewMs = Date.parse(due.replace(" ", "T") + "Z") - 3 * 86_400_000;
    const reviewDay = localDay(new Date(reviewMs));
    expect(cardsReviewedToday(db, reviewDay)).toBe(1);
    expect(cardsReviewedToday(db, nextLocalDay(reviewDay))).toBe(0);
  });

  it("ignores never-graded cards", () => {
    const db = freshDb();
    seedCard(db, "c1", { intervalDays: 0, due: "2026-07-24 15:00:00", lastGrade: null });
    // Whatever today is, a never-graded card contributes nothing.
    expect(cardsReviewedToday(db, localDay())).toBe(0);
  });
});

describe("dayGoal — met only when work was done AND the queue is clear", () => {
  it("is not met with nothing to do", () => {
    const db = freshDb();
    expect(dayGoal(db, localDay()).met).toBe(false);
  });

  it("is not met while a card is still due", () => {
    const db = freshDb();
    const today = localDay();
    // one reviewed-today card (due in the future) + one still due now.
    seedCard(db, "done", { intervalDays: 2, due: "datetimeplaceholder", lastGrade: "good" });
    // set the reviewed card's due to now+2d so its last review is ~today
    db.prepare("UPDATE cards SET due = datetime('now','+2 days') WHERE id = 'done'").run();
    seedCard(db, "due", { intervalDays: 0, due: "datetimeplaceholder", lastGrade: null });
    db.prepare("UPDATE cards SET due = datetime('now') WHERE id = 'due'").run();

    const g = dayGoal(db, today);
    expect(g.done).toBeGreaterThanOrEqual(1);
    expect(g.dueRemaining).toBeGreaterThanOrEqual(1);
    expect(g.met).toBe(false);
    expect(g.total).toBe(g.done + g.dueRemaining);
  });

  it("is met once the queue is clear and ≥1 card was reviewed today", () => {
    const db = freshDb();
    const today = localDay();
    seedCard(db, "done", { intervalDays: 2, due: "datetimeplaceholder", lastGrade: "good" });
    db.prepare("UPDATE cards SET due = datetime('now','+2 days') WHERE id = 'done'").run();
    const g = dayGoal(db, today);
    expect(g.done).toBe(1);
    expect(g.dueRemaining).toBe(0);
    expect(g.met).toBe(true);
  });
});

describe("the ledger — idempotent, authoritative, one row per completed day", () => {
  it("records a completed day exactly once and never double-counts", () => {
    const db = freshDb();
    const day = "2026-07-24";
    expect(isDayComplete(db, day)).toBe(false);
    expect(recordDayComplete(db, day, { cardsDone: 9, lessonsDone: 1 })).toBe(true);
    expect(recordDayComplete(db, day, { cardsDone: 99 })).toBe(false); // no-op, figures unchanged
    expect(isDayComplete(db, day)).toBe(true);

    const row = getDayCompletion(db, day)!;
    expect(row.cardsDone).toBe(9);
    expect(row.lessonsDone).toBe(1);
    expect(completedDayCount(db)).toBe(1);
  });

  it("completeDayIfMet writes only when the goal is met, idempotently", () => {
    const db = freshDb();
    const today = localDay();
    // Not met yet → no row.
    expect(completeDayIfMet(db, today)).toBeNull();
    expect(completedDayCount(db)).toBe(0);

    // Meet the goal: one card reviewed today, none due.
    seedCard(db, "done", { intervalDays: 2, due: "datetimeplaceholder", lastGrade: "good" });
    db.prepare("UPDATE cards SET due = datetime('now','+2 days') WHERE id = 'done'").run();

    const first = completeDayIfMet(db, today)!;
    expect(first.cardsDone).toBe(1);
    // A second call is a no-op returning the same (first-recorded) row.
    const second = completeDayIfMet(db, today)!;
    expect(second.completedAt).toBe(first.completedAt);
    expect(completedDayCount(db)).toBe(1);
  });
});
