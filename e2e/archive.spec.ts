import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { openDatabase, type Db } from "../lib/db";
import { createSession } from "../lib/sessions";
import { persistSegmentFindings, type Category, type Severity } from "../lib/analysis/findings";
import { ensureSessionDir, sourcePath } from "../lib/audio-storage";

// The Speech archive screen end to end (E-11 criteria 1–4), against the throwaway
// DB the dev server uses (playwright.config env). Each test wipes the tables it
// touches and seeds its own sessions/findings. It asserts the chronological
// grouping, the combined filters, the empty state, the sidebar item, and that
// activating a row deep-links to its session and positions the reused player.

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

interface Row { quote: string; category: Category; severity: Severity; startMs: number }

let seq = 0;
/** Seed one session at a fixed capture date; optionally stage a real playable WAV. */
async function seedSession(createdAt: string, rows: Row[], withAudio = false): Promise<string> {
  const id = randomUUID();
  let sizeBytes = 1;
  if (withAudio) {
    await ensureSessionDir(id);
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-ac", "1", "-ar", "8000", sourcePath(id, "wav")],
      { stdio: "ignore" },
    );
    sizeBytes = fs.statSync(sourcePath(id, "wav")).size;
  }
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes, durationSeconds: 8 });
  db().prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(createdAt, id);
  for (const r of rows) {
    persistSegmentFindings(db(), {
      sessionId: id,
      contentHash: `${id}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [{ quote: r.quote, correction: `${r.quote} (recast)`, category: r.category, explanation: "why this reads non-native", severity: r.severity, startMs: r.startMs, endMs: r.startMs + 500 }],
    });
  }
  return id;
}

test.describe("archive screen", () => {
  test("renders the timeline newest session first and groups by session (criterion 1)", async ({ page }) => {
    await seedSession("2026-07-10 09:00:00", [{ quote: "he go to work", category: "grammar", severity: "high", startMs: 3000 }]);
    await seedSession("2026-07-12 09:00:00", [{ quote: "make a photo", category: "vocabulary", severity: "medium", startMs: 2000 }]);

    await page.goto("/archive");
    await expect(page.locator("[data-archive]")).toBeVisible();

    const groups = page.locator("[data-group]");
    await expect(groups).toHaveCount(2);
    // Newest session's group is first, and it carries the vocabulary moment.
    await expect(groups.first()).toContainText("make a photo");
    await expect(groups.last()).toContainText("he go to work");
  });

  test("search, category and severity filters narrow and intersect (criteria 2–3)", async ({ page }) => {
    await seedSession("2026-07-10 09:00:00", [
      { quote: "he go to work", category: "grammar", severity: "high", startMs: 1000 },
      { quote: "make a photo", category: "vocabulary", severity: "medium", startMs: 2000 },
      { quote: "it rains cats", category: "idiom", severity: "low", startMs: 3000 },
    ]);
    await page.goto("/archive");
    const entries = page.locator("[data-entry]");
    await expect(entries).toHaveCount(3);

    // Search narrows to the matching quote.
    await page.locator("[data-search]").fill("photo");
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("make a photo");
    await page.locator("[data-search]").fill("");

    // Category filter alone.
    await page.locator("[data-chip='category:idiom']").click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("it rains cats");

    // Add a severity that no idiom row has → empty; the intersection is honoured.
    await page.locator("[data-chip='severity:high']").click();
    await expect(page.locator("[data-no-match]")).toBeVisible();

    // Back to grammar+high → the one grammar row.
    await page.locator("[data-chip='category:grammar']").click();
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText("he go to work");
  });

  test("a row deep-links to its session and positions the player at the moment (criterion 4)", async ({ page }) => {
    const id = await seedSession("2026-07-10 09:00:00", [{ quote: "he go to work", category: "grammar", severity: "high", startMs: 4000 }], true);

    await page.goto("/archive");
    const entry = page.locator("[data-entry]").first();
    await expect(entry).toHaveAttribute("data-start-ms", "4000");
    // Correction-forward (E-30 P1, D-18): the row leads with the recast and links
    // back to the moment from that headline; the error is behind a reveal, so the
    // deep link is the headline control, not the whole row.
    await entry.locator("[data-entry-jump]").click();

    await expect(page).toHaveURL(new RegExp(`/sessions/${id}\\?t=4000`));
    // The player loads metadata then the deep link seeks it to ~4s (4000ms). It may
    // then play (autoplay is allowed under the fake-media e2e), so the upper bound
    // absorbs a little drift — the point is it jumped near the finding's start, not 0.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0))
      .toBeGreaterThan(3.8);
    expect(await page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0)).toBeLessThan(5.0);
  });

  test("shows a quiet empty state when nothing is analyzed", async ({ page }) => {
    await page.goto("/archive");
    await expect(page.getByText("Nothing yet.", { exact: false })).toBeVisible();
    await expect(page.locator("[data-archive]")).toHaveCount(0);
  });

  test("adds Archive to the sidebar nav", async ({ page }) => {
    await page.goto("/archive");
    const link = page.locator('nav[aria-label="Primary"] a', { hasText: "Archive" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});
