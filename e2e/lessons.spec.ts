import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { persistSegmentFindings, type Category } from "../lib/analysis/findings";
import { generateCards } from "../lib/cards";
import { insertLesson } from "../lib/lessons/lessons";
import { writeSettings } from "../lib/settings";
import { recordSpend } from "../lib/analysis/budget";

// The lesson runner under Practice end to end (E-6b, WO criteria 1-4), against the
// throwaway DB the dev server uses (playwright.config env). Every test wipes the
// tables it touches and seeds its own findings + a CACHED lesson row, so a lesson
// opens with no model call (criterion 2). Multiple-choice and fill-in are checked
// client-side (deterministic); the rewrite grade is intercepted so no real model
// is called (criterion 3). A separate budget-reached test proves the truthful cap
// state without a broken screen.

process.env.ERIKA_DATA_DIR = process.env.ERIKA_DATA_DIR ?? ".playwright/e2e-data";
const DB_PATH = process.env.ERIKA_DB_PATH ?? ".playwright/e2e.db";

let conn: Db | null = null;
function db(): Db {
  if (!conn) conn = openDatabase(DB_PATH);
  return conn;
}

test.afterAll(() => {
  conn?.close();
  conn = null;
});

test.beforeEach(() => {
  const d = db();
  for (const t of [
    "lessons",
    "lesson_mastery",
    "cards",
    "deleted_findings",
    "findings",
    "segment_analyses",
    "segments",
    "analysis_jobs",
    "ingest_jobs",
    "sessions",
    "spend_ledger",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  writeSettings(d, { monthlyBudgetUsd: 25 }); // reset the cap between tests
});

let seq = 0;
/** Seed one session carrying `n` grammar findings — three make a pattern. */
function seedGrammarFindings(n: number): string {
  const id = randomUUID();
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  for (let i = 0; i < n; i++) {
    persistSegmentFindings(db(), {
      sessionId: id,
      contentHash: `${id}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [
        {
          quote: `he go ${i}`,
          correction: `he goes ${i}`,
          category: "grammar" as Category,
          explanation: "third-person singular takes an -s",
          severity: "high" as const,
          startMs: i * 1000,
          endMs: i * 1000 + 500,
        },
      ],
    });
  }
  return id;
}

const EXPLANATION = "In the present simple, third-person singular verbs take an -s.";

/** Seed the cached lesson for the grammar pattern so opening it makes no model call. */
function seedCachedLesson(): void {
  insertLesson(db(), "category:grammar", {
    explanation: EXPLANATION,
    exercises: [
      { type: "multiple_choice", prompt: "Pick the correct sentence.", options: ["He go home", "He goes home"], answerIndex: 1 },
      { type: "fill_in", prompt: "She ___ to work every day. (go)", answer: "goes" },
      { type: "rewrite", prompt: "Rewrite: 'He go to work.'", target: "He goes to work." },
    ],
  });
}

test.describe("lessons under Practice", () => {
  test("Practice offers a lessons entry and lists patterns with count + mastery (criterion 1)", async ({
    page,
  }) => {
    seedGrammarFindings(3);
    generateCards(db()); // the due-queue still works alongside lessons (regression)

    await page.goto("/practice");
    await expect(page.locator("[data-due-count]")).toHaveText("3"); // flashcard queue intact
    const entry = page.locator("[data-work-on-pattern]").first();
    await expect(entry).toBeVisible();

    await entry.click();
    await expect(page.locator("[data-lessons-list]")).toBeVisible();
    const pattern = page.locator('[data-pattern][data-key="category:grammar"]');
    await expect(pattern.locator("[data-count]")).toHaveText("3 findings");
    await expect(pattern.locator("[data-mastery]")).toHaveText("0%");
  });

  test("shows a quiet empty state when no pattern qualifies (criterion 1)", async ({ page }) => {
    seedGrammarFindings(2); // below the threshold of 3 — not a pattern
    await page.goto("/practice/lessons");
    await expect(page.locator("[data-lessons-empty]")).toBeVisible();
    await expect(page.locator("[data-lessons-list]")).toHaveCount(0);
  });

  test("opens a cached lesson without a model call and marks MC right/wrong (criteria 2 & 3)", async ({
    page,
  }) => {
    seedGrammarFindings(3);
    seedCachedLesson();

    await page.goto("/practice/lessons/category%3Agrammar");
    // The seeded explanation renders verbatim — proof the cache was served, since a
    // real generation (no key in CI) would 502 into the error state instead.
    await expect(page.locator("[data-lesson-explanation]")).toHaveText(EXPLANATION);

    const exercise = page.locator("[data-exercise]");
    await expect(exercise).toHaveAttribute("data-exercise-type", "multiple_choice");

    // Pick the wrong option → it marks wrong and reveals the correct one.
    await exercise.locator("[data-option]").nth(0).click();
    await expect(exercise.locator("[data-result]")).toHaveAttribute("data-correct", "false");
    await expect(exercise.locator('[data-option][data-correct="true"]')).toBeVisible();
    await expect(exercise.locator('[data-option][data-picked="true"]')).toBeVisible();

    // Only one lesson row exists — nothing was generated on open.
    const rows = db().prepare("SELECT COUNT(*) AS n FROM lessons").get() as { n: number };
    expect(rows.n).toBe(1);
  });

  test("runs MC + fill-in + a stubbed rewrite grade, then completion updates mastery (criteria 3 & 4)", async ({
    page,
  }) => {
    seedGrammarFindings(3);
    seedCachedLesson();

    // Stub the model grade so no real call fires; deterministic "correct".
    await page.route("**/api/lessons/grade", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ correct: true, feedback: "Natural and correct." }),
      }),
    );

    await page.goto("/practice/lessons/category%3Agrammar");
    const exercise = page.locator("[data-exercise]");

    // MC: pick the correct option, then advance.
    await exercise.locator("[data-option]").nth(1).click();
    await expect(exercise.locator("[data-result]")).toHaveAttribute("data-correct", "true");
    await page.locator("[data-next]").click();

    // Fill-in: type the answer (case/space-insensitive), check, advance.
    await expect(exercise).toHaveAttribute("data-exercise-type", "fill_in");
    await exercise.locator("[data-fill-input]").fill("  Goes ");
    await exercise.locator("[data-check]").click();
    await expect(exercise.locator("[data-result]")).toHaveAttribute("data-correct", "true");
    await page.locator("[data-next]").click();

    // Rewrite: the stubbed grade returns correct; then finish the lesson.
    await expect(exercise).toHaveAttribute("data-exercise-type", "rewrite");
    await exercise.locator("[data-rewrite-input]").fill("He goes to work.");
    await exercise.locator("[data-grade]").click();
    await expect(exercise.locator("[data-grade-feedback]")).toHaveAttribute("data-correct", "true");
    await page.locator("[data-finish]").click();

    // All three correct → score 1.0 → mastery 0 → 0.5 by the EMA rule (shown as 50%).
    await expect(page.locator("[data-lesson-complete] [data-mastery]")).toHaveText("50%");
    await expect
      .poll(() => (db().prepare("SELECT mastery FROM lesson_mastery WHERE pattern_key = 'category:grammar'").get() as { mastery: number } | undefined)?.mastery)
      .toBeCloseTo(0.5, 5);

    // The list reflects the new mastery.
    await page.goto("/practice/lessons");
    await expect(page.locator('[data-pattern][data-key="category:grammar"] [data-mastery]')).toHaveText("50%");
  });

  test("shows a truthful budget-reached state, not a broken screen (criterion 2)", async ({ page }) => {
    seedGrammarFindings(3); // a pattern exists, but NO cached lesson — generate must run
    writeSettings(db(), { monthlyBudgetUsd: 0.001 });
    recordSpend(db(), { model: "gpt-audio-mini", contentHash: "x", costUsd: 0.001 }); // cap reached

    await page.goto("/practice/lessons/category%3Agrammar");
    await expect(page.locator("[data-budget-reached]")).toBeVisible();
    await expect(page.getByText("Monthly budget reached", { exact: false })).toBeVisible();
    // Nothing was generated under the cap.
    const rows = db().prepare("SELECT COUNT(*) AS n FROM lessons").get() as { n: number };
    expect(rows.n).toBe(0);
  });
});
