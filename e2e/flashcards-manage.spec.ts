import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { persistSegmentFindings, type Category, type Severity } from "../lib/analysis/findings";
import { generateCards, listCards, listDueCards } from "../lib/cards";

// The card browser end to end (E-5b), against the throwaway DB the dev server uses
// (playwright.config env). Like the drill suite, every test wipes the tables it
// touches and seeds only its own findings, so it never leans on a shared DB. We
// drive suspend/unsuspend and the confirm-guarded delete through the real UI and
// assert, from the DB, that the due queue and card set actually changed.

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
  for (const t of ["deleted_findings", "cards", "findings", "segment_analyses", "segments", "analysis_jobs", "ingest_jobs", "sessions"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

let seq = 0;
function seedFindings(n: number): void {
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
          quote: `phrase ${i}`,
          correction: `recast ${i}`,
          category: "grammar" as Category,
          explanation: "why this reads as non-native",
          severity: "high" as Severity,
          startMs: i * 1000,
          endMs: i * 1000 + 500,
        },
      ],
    });
  }
  generateCards(db());
}

test.describe("card browser", () => {
  test("suspend removes a card from the due queue and unsuspend restores it (criterion 2)", async ({ page }) => {
    seedFindings(2);
    await page.goto("/practice/cards");
    const rows = page.locator("[data-card]");
    await expect(rows).toHaveCount(2);

    // Suspend the first row → it is marked and drops out of the due queue.
    await rows.first().locator("[data-suspend]").click();
    await expect(rows.first()).toHaveAttribute("data-suspended", "true");
    await expect.poll(() => listDueCards(db()).length).toBe(1);

    // Unsuspend → back in the queue.
    await rows.first().locator("[data-suspend]").click();
    await expect(rows.first()).toHaveAttribute("data-suspended", "false");
    await expect.poll(() => listDueCards(db()).length).toBe(2);
  });

  test("delete confirms first, then removes the card and it never resurrects (criteria 3)", async ({ page }) => {
    seedFindings(2);
    await page.goto("/practice/cards");
    const rows = page.locator("[data-card]");
    await expect(rows).toHaveCount(2);

    // Clicking Delete does NOT remove yet — it asks to confirm (no accidental loss).
    await rows.first().locator("[data-delete]").click();
    await expect(rows.first().locator("[data-confirm-delete]")).toBeVisible();
    await expect(rows).toHaveCount(2);
    expect(listCards(db())).toHaveLength(2);

    // Confirm → the card is gone from the browser and the DB.
    await rows.first().locator("[data-confirm-delete]").click();
    await expect(rows).toHaveCount(1);
    await expect.poll(() => listCards(db()).length).toBe(1);

    // Visiting Practice regenerates cards from findings — the deleted one stays gone.
    await page.goto("/practice");
    await page.goto("/practice/cards");
    await expect(page.locator("[data-card]")).toHaveCount(1);
  });

  test("export returns an Anki CSV with the right headers and RFC 4180 escaping (criterion 4)", async ({ page }) => {
    seedFindings(1);
    // The error carries a comma, a quote, and a newline — it rides the Back once
    // ("You said: …"), correction-forward (E-29); the Front never shows it (D-18).
    db().prepare("UPDATE findings SET quote = ?").run('he said, "hi"\nthere');

    await page.goto("/practice/cards");
    await expect(page.locator("[data-export]")).toBeVisible();

    const res = await page.request.get("/api/cards/export");
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain('filename="erika-cards.csv"');
    const text = await res.text();
    expect(text).toContain('""hi""'); // RFC 4180 doubled quotes — escaping survives
    expect(text).toContain('You said: he said, "hi"\nthere'); // the error, once, on the Back
  });
});
