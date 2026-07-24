import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { buildToday } from "@/lib/today";
import { completeDayIfMet } from "@/lib/day-ledger";
import { localDay } from "@/lib/local-day";

// The Learn TODAY read-model (E-31): the composed plan reduced to the calm home
// surface, and the once-per-day completion transition.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-today-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A card reviewed today (due in the future) — no scaffolding beyond a session+finding. */
function seedReviewedCard(db: Db): void {
  db.prepare(
    "INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds) VALUES ('s1','t.wav','wav',1,60)",
  ).run();
  db.prepare(
    `INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
     VALUES ('f1','s1','h','q','c','grammar','why','low',0,1)`,
  ).run();
  db.prepare(
    `INSERT INTO cards (id, finding_id, session_id, front, back, category, start_ms, ease, interval_days, repetitions, due, last_grade, suspended)
     VALUES ('c1','f1','s1','fr','bk','grammar',0,2.5,2,1, datetime('now','+2 days'),'good',0)`,
  ).run();
}

describe("buildToday", () => {
  it("surfaces the composer's new-item counts and a clear (empty) goal on a fresh DB", () => {
    const db = freshDb();
    const view = buildToday(db, "2026-07-24");
    expect(view.newItems.vocab).toBe(10); // default cap, real seeded lexicon
    expect(view.newItems.rules).toBeGreaterThan(0);
    expect(view.newItems.rules).toBeLessThanOrEqual(3);
    expect(view.goal).toEqual({ done: 0, total: 0 });
    expect(view.complete).toBe(false);
    expect(view.dueCount).toBe(0);
    db.close();
  });

  it("reflects the once-per-day completion once the ledger records it", () => {
    const db = freshDb();
    seedReviewedCard(db);
    const day = localDay();

    // Goal met (one card done, none due) but not yet recorded → not complete.
    const before = buildToday(db, day);
    expect(before.goal.done).toBe(1);
    expect(before.goal.total).toBe(1);
    expect(before.dueCount).toBe(0);
    expect(before.complete).toBe(false);

    // Record it (what POST /api/day/complete does) → now complete with figures.
    completeDayIfMet(db, day);
    const after = buildToday(db, day);
    expect(after.complete).toBe(true);
    expect(after.completion).toEqual({ cardsDone: 1, lessonsDone: 0 });
    db.close();
  });
});
