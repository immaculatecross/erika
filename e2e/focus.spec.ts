import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { upsertSegment } from "../lib/segments";
import { persistSegmentFindings, type Category, type Severity } from "../lib/analysis/findings";

// The Focus screen end to end (E-7 criterion 4), against the throwaway DB the dev
// server uses (playwright.config env). Each test wipes the tables it touches and
// seeds its own analyzed session, so it never depends on pre-existing state. It
// asserts the screen presents the per-category ranking, the trend, and the hero
// rate together — and that with nothing analyzed it shows the quiet empty state.

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
  for (const t of ["cards", "findings", "segment_analyses", "segments", "analysis_jobs", "ingest_jobs", "sessions"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const HOUR = 3_600_000;
let seq = 0;

/** Seed one analyzed session: an hour of speech and `cats` findings, marked done. */
function seedAnalyzed(cats: Category[]): string {
  const id = randomUUID();
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  const hash = `${id}-h0`;
  upsertSegment(db(), { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: hash });
  persistSegmentFindings(db(), {
    sessionId: id,
    contentHash: hash,
    flagged: true,
    deepDone: true,
    findings: cats.map((category, i) => ({
      quote: `phrase ${seq + i}`,
      correction: `recast ${seq + i}`,
      category,
      explanation: "why this reads as non-native",
      severity: "high" as Severity,
      startMs: i * 1000,
      endMs: i * 1000 + 500,
    })),
  });
  seq += cats.length;
  const job = db().prepare("SELECT id FROM analysis_jobs WHERE session_id=?").get(id) as { id: string } | undefined;
  if (!job) {
    db().prepare("INSERT INTO analysis_jobs (id, session_id, state, progress) VALUES (?,?, 'done', 1)").run(randomUUID(), id);
  }
  return id;
}

test.describe("focus screen", () => {
  test("presents the hero rate, the ranking, and a trend once a session is analyzed", async ({ page }) => {
    seedAnalyzed(["grammar", "grammar", "idiom"]);

    await page.goto("/focus");
    await expect(page.locator("[data-focus]")).toBeVisible();

    // The hero is the error rate per speaking hour — 3 findings over 1 h.
    await expect(page.locator("[data-focus-rate]")).toHaveText("3.0");

    // All five categories rank, skewed grammar (2) ahead of idiom (1).
    await expect(page.locator("[data-category-rank]")).toHaveCount(5);
    const first = page.locator("[data-category-bars] li").first();
    await expect(first).toHaveAttribute("data-category-rank", "grammar");

    // The trend sparkline renders.
    await expect(page.locator("[data-sparkline]")).toBeVisible();
  });

  test("shows a quiet empty state when nothing is analyzed", async ({ page }) => {
    await page.goto("/focus");
    await expect(page.getByText("Nothing analyzed yet.")).toBeVisible();
    await expect(page.locator("[data-focus]")).toHaveCount(0);
  });

  test("adds Focus to the sidebar nav", async ({ page }) => {
    await page.goto("/focus");
    const link = page.locator('nav[aria-label="Primary"] a', { hasText: "Focus" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});
