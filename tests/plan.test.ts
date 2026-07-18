import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category, type Severity } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { generateCards } from "@/lib/cards";
import { buildPlan, getViewedLetterWeek, markLetterViewed } from "@/lib/plan";
import { buildFocusModel } from "@/lib/focus";
import { insertLesson } from "@/lib/lessons/lessons";
import { lessonEstimateUsd } from "@/lib/lessons/estimate";
import { derivePatterns } from "@/lib/lessons/patterns";
import { listIncludedFindings } from "@/lib/findings-model";

// E-18 criterion 1: /practice composes a daily plan — the due-card count, the
// one lesson Focus's severity-weighted ranking prescribes next (the ranking is
// REUSED from computeFocus, asserted against buildFocusModel itself, never a
// second scoring), and the unread letter for the latest ISO week, whose viewed
// marker persists in the existing settings kv storage (no migration).

const HOUR = 3_600_000;
const WEEK = "2026-07-13"; // a Monday

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-plan-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

/** Seed one fully-analysed session whose findings are the given category/severity pairs. */
function seed(db: Db, id: string, findings: { category: Category; severity: Severity }[]): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${WEEK} 09:00:00`, id);
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: `${id}-h0` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h0`,
    flagged: true,
    deepDone: true,
    findings: findings.map((f, i) => ({
      quote: `q${i}`,
      correction: `c${i}`,
      category: f.category,
      explanation: "why",
      severity: f.severity,
      startMs: i * 1000,
      endMs: i * 1000 + 500,
    })),
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = 'done', progress = 1 WHERE id = ?").run(job.id);
}

describe("buildPlan — the daily plan (E-18 criterion 1)", () => {
  it("is quietly empty before anything exists", () => {
    const db = freshDb();
    expect(buildPlan(db)).toEqual({ dueCount: 0, lesson: null, letterWeek: null, letterUnread: false });
  });

  it("counts the due queue and prescribes the top-ranked qualifying pattern", () => {
    const db = freshDb();
    // grammar: 3 high (weight 9) — vocabulary: 4 low (weight 4). Both qualify
    // (>= 3 findings); the severity-weighted ranking puts grammar first.
    seed(db, "s1", [
      ...Array.from({ length: 3 }, () => ({ category: "grammar", severity: "high" }) as const),
      ...Array.from({ length: 4 }, () => ({ category: "vocabulary", severity: "low" }) as const),
    ]);
    generateCards(db);

    const plan = buildPlan(db);
    expect(plan.dueCount).toBe(7); // every finding became a due card
    expect(plan.lesson).not.toBeNull();
    expect(plan.lesson!.category).toBe("grammar");
    expect(plan.lesson!.count).toBe(3);
    // The prescription IS Focus's ranking — same first category, reused not rebuilt.
    expect(buildFocusModel(db).ranking[0].category).toBe("grammar");
    // No lesson generated yet: the honest price via the existing estimate machinery.
    expect(plan.lesson!.ready).toBe(false);
    const pattern = derivePatterns(listIncludedFindings(db)).find((p) => p.category === "grammar")!;
    expect(plan.lesson!.estimateUsd).toBeCloseTo(lessonEstimateUsd(db, pattern), 10);
    expect(plan.lesson!.estimateUsd!).toBeGreaterThan(0);
  });

  it("skips a top-ranked category that does not qualify as a pattern", () => {
    const db = freshDb();
    // idiom: 2 high (weight 6) outranks grammar: 3 low (weight 3), but only
    // grammar has >= 3 findings — the plan prescribes what can actually be worked.
    seed(db, "s1", [
      ...Array.from({ length: 2 }, () => ({ category: "idiom", severity: "high" }) as const),
      ...Array.from({ length: 3 }, () => ({ category: "grammar", severity: "low" }) as const),
    ]);
    const plan = buildPlan(db);
    expect(buildFocusModel(db).ranking[0].category).toBe("idiom");
    expect(plan.lesson!.category).toBe("grammar");
  });

  it("says 'ready' with no price once the lesson is generated", () => {
    const db = freshDb();
    seed(
      db,
      "s1",
      Array.from({ length: 3 }, () => ({ category: "grammar", severity: "high" }) as const),
    );
    insertLesson(db, "category:grammar", {
      explanation: "short",
      exercises: [{ type: "fill_in", prompt: "p", answer: "a" }],
    });
    const plan = buildPlan(db);
    expect(plan.lesson!.ready).toBe(true);
    expect(plan.lesson!.estimateUsd).toBeNull();
  });

  it("carries the latest week's letter as unread until it is opened, in the settings kv", () => {
    const db = freshDb();
    seed(db, "s1", [{ category: "grammar", severity: "high" }]);

    const before = buildPlan(db);
    expect(before.letterWeek).toBe(WEEK);
    expect(before.letterUnread).toBe(true);

    markLetterViewed(db, WEEK);
    expect(buildPlan(db).letterUnread).toBe(false);

    // The marker lives in the EXISTING settings key/value table — no migration.
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'letterViewedWeek'")
      .get() as { value: string };
    expect(row.value).toBe(WEEK);

    // Forward-only: re-reading an older archived week never un-reads this one.
    markLetterViewed(db, "2026-07-06");
    expect(getViewedLetterWeek(db)).toBe(WEEK);
    expect(buildPlan(db).letterUnread).toBe(false);
  });
});
