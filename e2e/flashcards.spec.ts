import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { persistSegmentFindings, type Category, type Severity } from "../lib/analysis/findings";
import { generateCards, listDueCards } from "../lib/cards";

// The flashcard drill end to end (E-5), against the throwaway DB the dev server
// uses (playwright.config env). A prior review flagged the shared e2e.db causing
// dirty-state false failures, so every test starts from a clean slate: beforeEach
// wipes the tables this suite touches and seeds exactly its own findings — the
// spec never depends on a pre-existing DB. We drive the full-screen session purely
// by keyboard and assert, from the DB, that the SM-2 schedule actually changed.

process.env.ERIKA_DATA_DIR = process.env.ERIKA_DATA_DIR ?? ".playwright/e2e-data";
const DB_PATH = process.env.ERIKA_DB_PATH ?? ".playwright/e2e.db";

// One connection for the whole spec — reopening on every helper call churns WAL
// connections and adds lock contention that can slow the dev server's own polling.
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
  // Wipe everything downstream of a session; cards cascade off findings.
  for (const t of ["cards", "findings", "segment_analyses", "segments", "analysis_jobs", "ingest_jobs", "sessions"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

let seq = 0;
/** Seed one session carrying `n` findings, each on its own content hash. */
function seedFindings(n: number): string {
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
          // Quote and correction share context (…a scuola ${i}) so the derived
          // meaning-first front is a distinct context gap per card (E-29).
          quote: `vado a scuola ${i}`,
          correction: `sono andato a scuola ${i}`,
          category: "grammar" as Category,
          explanation: "why this reads as non-native",
          severity: "high" as Severity,
          startMs: i * 1000,
          endMs: i * 1000 + 500,
        },
      ],
    });
  }
  return id;
}

test.describe("flashcard drill", () => {
  test("Practice shows the due count, and the full-screen session flips, grades, and advances by keyboard (criteria 3 & 4)", async ({
    page,
  }) => {
    seedFindings(2);

    // The Practice screen generates cards from the findings and shows the count.
    await page.goto("/practice");
    await expect(page.locator("[data-due-count]")).toHaveText("2");

    await page.locator("[data-start-practice]").click();
    const review = page.locator("[data-review]");
    await expect(review).toHaveAttribute("data-review-phase", "active");
    await expect(review).toHaveAttribute("data-card-index", "0");

    const card = page.locator("[data-flashcard]");
    await expect(card).toHaveAttribute("data-flipped", "false");
    const firstFront = await page.locator('[data-flashcard] [data-face="front"]').first().innerText();

    // Space flips the card to its back; a grade key (3 = Good) advances to card 2.
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("data-flipped", "true");
    await page.keyboard.press("3");

    await expect(review).toHaveAttribute("data-card-index", "1");
    await expect(card).toHaveAttribute("data-flipped", "false"); // the next card starts face-up
    const secondFront = await page.locator('[data-flashcard] [data-face="front"]').first().innerText();
    expect(secondFront).not.toBe(firstFront); // a different card is now showing

    // Grade the second card too → the queue empties → the quiet done state.
    await page.keyboard.press("Space");
    await page.keyboard.press("4"); // Easy
    await expect(review).toHaveAttribute("data-review-phase", "done");
    await expect(page.locator("[data-review-done]")).toBeVisible();

    // The schedule genuinely changed: both cards now carry a grade and a future due.
    await expect
      .poll(() => {
        const rows = db()
          .prepare("SELECT last_grade, due FROM cards")
          .all() as { last_grade: string | null; due: string }[];
        return rows.length === 2 && rows.every((r) => r.last_grade !== null);
      })
      .toBe(true);
    const graded = db()
      .prepare("SELECT COUNT(*) AS n FROM cards WHERE last_grade IS NOT NULL AND due > datetime('now')")
      .get() as { n: number };
    expect(graded.n).toBe(2); // both pushed into the future — neither is due now
  });

  test("only due, non-suspended cards appear in the queue (criterion 3)", async () => {
    seedFindings(3);
    generateCards(db()); // deterministic — the page would do the same on load
    const cards = listDueCards(db());
    expect(cards).toHaveLength(3);

    // Suspend one and push another a day out; only the third stays due.
    db().prepare("UPDATE cards SET suspended = 1 WHERE id = ?").run(cards[0].id);
    db().prepare("UPDATE cards SET due = datetime('now', '+1 day') WHERE id = ?").run(cards[1].id);
    expect(listDueCards(db()).map((c) => c.id)).toEqual([cards[2].id]);
  });

  test("reduced motion degrades the flip to a crossfade — no rotation (criterion 4)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    seedFindings(1);
    generateCards(db());

    await page.goto("/practice/review");
    const card = page.locator("[data-flashcard]");
    await expect(card).toHaveAttribute("data-motion", "crossfade");

    // Flipping still swaps faces, but the variant stays the crossfade (never flip).
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("data-flipped", "true");
    await expect(card).toHaveAttribute("data-motion", "crossfade");
  });
});
