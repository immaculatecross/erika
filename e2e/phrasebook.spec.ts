import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { persistSegmentFindings, type Category } from "../lib/analysis/findings";
import { generateCards } from "../lib/cards";

// The Phrasebook screen end to end (E-9 criteria 1, 3, 4), against the throwaway
// DB the dev server uses (playwright.config env). Each test wipes the tables it
// touches and seeds its own findings, so it never depends on pre-existing state.
// It asserts both sides render, the already-in-deck marker is truthful, pinning a
// fresh entry moves it into the deck, and with no findings a quiet empty state shows.

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
  for (const t of ["cards", "deleted_findings", "findings", "segment_analyses", "segments", "analysis_jobs", "ingest_jobs", "sessions"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

let seq = 0;
/** Seed one session with a finding per (quote, correction, category) tuple. */
function seedFindings(rows: { quote: string; correction: string; category: Category }[]): string {
  const id = randomUUID();
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  for (const r of rows) {
    persistSegmentFindings(db(), {
      sessionId: id,
      contentHash: `${id}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [{ quote: r.quote, correction: r.correction, category: r.category, explanation: "why this reads non-native", severity: "high", startMs: 0, endMs: 500 }],
    });
  }
  return id;
}

test.describe("phrasebook screen", () => {
  test("renders recasts side by side and marks the already-in-deck entry truthfully", async ({ page }) => {
    seedFindings([{ quote: "he go to work", correction: "he goes to work", category: "grammar" }]);
    generateCards(db()); // v0.1 auto-generates a card, so this entry is already in the deck

    await page.goto("/phrasebook");
    await expect(page.locator("[data-phrasebook]")).toBeVisible();

    const entry = page.locator("[data-entry]").first();
    await expect(entry).toContainText("he go to work"); // you say
    await expect(entry).toContainText("he goes to work"); // natives say
    await expect(entry).toHaveAttribute("data-in-deck", "true");
    await expect(entry.locator("[data-in-deck-marker]")).toBeVisible();
    await expect(entry.locator("[data-pin]")).toHaveCount(0); // no pin button when already in deck
  });

  test("pins a fresh entry into the deck", async ({ page }) => {
    const sid = seedFindings([{ quote: "make a photo", correction: "take a photo", category: "vocabulary" }]);
    // Tombstone the finding so it deterministically starts out of the deck even if
    // another spec's /practice visit fires a racing generateCards (which skips
    // tombstoned findings). Pinning must un-tombstone and add it — the E-9 contract.
    const fid = (db().prepare("SELECT id FROM findings WHERE session_id = ?").get(sid) as { id: string }).id;
    db().prepare("INSERT OR IGNORE INTO deleted_findings (finding_id) VALUES (?)").run(fid);

    await page.goto("/phrasebook");
    const entry = page.locator("[data-entry]").first();
    await expect(entry).toHaveAttribute("data-in-deck", "false");

    await entry.locator("[data-pin]").click();
    await expect(entry).toHaveAttribute("data-in-deck", "true");
    await expect(entry.locator("[data-in-deck-marker]")).toBeVisible();
  });

  test("shows a quiet empty state when there are no findings", async ({ page }) => {
    await page.goto("/phrasebook");
    await expect(page.getByText("Nothing yet.", { exact: false })).toBeVisible();
    await expect(page.locator("[data-phrasebook]")).toHaveCount(0);
  });

  test("adds Phrasebook to the sidebar nav", async ({ page }) => {
    await page.goto("/phrasebook");
    const link = page.locator('nav[aria-label="Primary"] a', { hasText: "Phrasebook" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});
