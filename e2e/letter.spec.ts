import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { upsertSegment } from "../lib/segments";
import { persistSegmentFindings, type Category } from "../lib/analysis/findings";

// The editor's letter end to end (E-12 criterion 2), against the throwaway DB the
// dev server uses. Each test wipes the tables it touches and seeds its own analyzed
// sessions with pinned capture dates, so the ISO-week math is deterministic
// regardless of the real clock. It asserts the letter presents the headline rate,
// the trend against last week, the best recasts and the one thing — that with
// nothing analyzed it shows the quiet empty state — and that the Focus screen links
// to it. 2026-07-13 is a Monday; 2026-07-06 the Monday before.

process.env.ERIKA_DATA_DIR = process.env.ERIKA_DATA_DIR ?? ".playwright/e2e-data";
const DB_PATH = process.env.ERIKA_DB_PATH ?? ".playwright/e2e.db";

const CURRENT_WEEK = "2026-07-13 09:00:00";
const PRIOR_WEEK = "2026-07-06 09:00:00";

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

/** Seed one analyzed session at a pinned capture date with `cats` findings, done. */
function seedAnalyzed(createdAt: string, cats: Category[]): string {
  const id = randomUUID();
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db().prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(createdAt, id);
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
      severity: "high" as const,
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

test.describe("editor's letter", () => {
  test("presents the headline rate, an improving trend, recasts and the one thing", async ({ page }) => {
    seedAnalyzed(PRIOR_WEEK, ["grammar", "grammar", "grammar", "grammar"]); // 4/h last week
    seedAnalyzed(CURRENT_WEEK, ["grammar"]); // 1/h this week

    await page.goto("/letter");
    await expect(page.locator("[data-letter]")).toBeVisible();

    // The headline is this week's error rate — 1 finding over 1 h.
    await expect(page.locator("[data-letter-rate]")).toHaveText("1.0");

    // The trend fell 4/h → 1/h, so it reads improving (green, D-14).
    await expect(page.locator('[data-trend="improving"]')).toBeVisible();

    // The best recast(s) render both sides.
    await expect(page.locator("[data-recast]")).toHaveCount(1);

    // The one thing to work on next is the top category.
    await expect(page.locator('[data-focus-next-category="grammar"]')).toBeVisible();
  });

  test("shows no trend badge on a first week with no prior data", async ({ page }) => {
    seedAnalyzed(CURRENT_WEEK, ["grammar", "idiom"]); // only one week exists

    await page.goto("/letter");
    await expect(page.locator("[data-letter]")).toBeVisible();
    await expect(page.locator("[data-trend]")).toHaveCount(0); // no fabricated direction
  });

  test("shows a quiet empty state when nothing is analyzed", async ({ page }) => {
    await page.goto("/letter");
    await expect(page.getByText("Nothing analyzed yet.")).toBeVisible();
    await expect(page.locator("[data-letter]")).toHaveCount(0);
  });

  test("is reachable from the Focus screen — no new sidebar item", async ({ page }) => {
    seedAnalyzed(CURRENT_WEEK, ["grammar"]);

    await page.goto("/focus");
    await page.locator("[data-letter-link]").click();
    await expect(page).toHaveURL(/\/letter$/);
    await expect(page.locator("[data-letter]")).toBeVisible();

    // The letter added no 7th top-level nav item.
    await expect(page.locator('nav[aria-label="Primary"] a')).toHaveCount(6);
  });
});
