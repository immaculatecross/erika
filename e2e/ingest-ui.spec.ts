import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { openDatabase } from "../lib/db";
import { createSession } from "../lib/sessions";
import { upsertSegment } from "../lib/segments";
import { ensureSessionDir, sourcePath } from "../lib/audio-storage";

// The ingest UI end to end (E-3 part 2), driving the same throwaway DB/data dir
// the dev server uses (playwright.config env). We seed a session and its job
// row directly — the worker isn't run here; the page only reflects state — then
// mutate the row to prove the live, no-reload transition and that polling stops.

process.env.ERIKA_DATA_DIR = process.env.ERIKA_DATA_DIR ?? ".playwright/e2e-data";
const DB_PATH = process.env.ERIKA_DB_PATH ?? ".playwright/e2e.db";

function db() {
  return openDatabase(DB_PATH);
}

/** Seed a session with a real playable WAV of `seconds` and a queued job. */
async function seedSession(seconds: number): Promise<string> {
  const id = randomUUID();
  await ensureSessionDir(id);
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "1", "-ar", "8000", sourcePath(id, "wav")],
    { stdio: "ignore" },
  );
  const size = fs.statSync(sourcePath(id, "wav")).size;
  createSession(db(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: size, durationSeconds: seconds });
  return id;
}

function addSegment(id: string, idx: number, startMs: number, endMs: number) {
  upsertSegment(db(), { sessionId: id, idx, startMs, endMs, contentHash: `${id}-${idx}` });
}

function setJob(id: string, state: string, stage: string | null, progress: number, error: string | null = null) {
  db()
    .prepare("UPDATE ingest_jobs SET state=?, stage=?, progress=?, error=? WHERE session_id=?")
    .run(state, stage, progress, error, id);
}

test.describe("ingest UI", () => {
  test("live progress advances to done without a reload, then polling stops (criterion 1)", async ({ page }) => {
    const id = await seedSession(4);
    addSegment(id, 0, 500, 2000); // a segment already extracted mid-flight
    setJob(id, "processing", "segmenting", 0.7);

    await page.goto(`/sessions/${id}`);
    const ingest = page.locator("[data-ingest]");
    await expect(ingest).toHaveAttribute("data-ingest-state", "processing");
    await expect(page.locator("[data-progress-pct]")).toHaveText("70%");
    await expect(ingest).toHaveAttribute("data-polling", "true");

    // Mark the live document so a reload (which would clear it) is detectable.
    await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));

    // The worker would do this; we do it directly. The page must react by polling.
    setJob(id, "done", "done", 1);

    await expect(ingest).toHaveAttribute("data-ingest-state", "done", { timeout: 10_000 });
    await expect(ingest).toContainText("speech"); // raw → N speech line
    await expect(page.locator("[data-segment-timeline]")).toBeVisible();
    await expect(ingest).toHaveAttribute("data-polling", "false");

    // Same document — no navigation happened.
    expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(1);

    // Polling truly stopped: the fetch count is frozen after the terminal state.
    const count = await ingest.getAttribute("data-poll-count");
    await page.waitForTimeout(2500); // > two poll intervals
    expect(await ingest.getAttribute("data-poll-count")).toBe(count);
  });

  test("timeline renders segments at proportional offsets and selecting one seeks the player (criterion 3)", async ({
    page,
  }) => {
    const id = await seedSession(8);
    addSegment(id, 0, 1000, 3000); // 12.5% .. +25%
    addSegment(id, 1, 5000, 7000); // 62.5% .. +25%
    setJob(id, "done", "done", 1);

    await page.goto(`/sessions/${id}`);
    await expect(page.locator("[data-ingest]")).toHaveAttribute("data-ingest-state", "done");

    const blocks = page.locator("[data-segment-idx]");
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0)).toHaveAttribute("data-left", "12.5000");
    await expect(blocks.nth(0)).toHaveAttribute("data-width", "25.0000");
    await expect(blocks.nth(1)).toHaveAttribute("data-left", "62.5000");
    await expect(blocks.nth(1)).toHaveAttribute("data-width", "25.0000");

    // Wait for the player to have metadata so a seek sticks.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.readyState ?? 0))
      .toBeGreaterThanOrEqual(1);

    await blocks.nth(1).click(); // seek to 5.0s
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0))
      .toBeGreaterThan(4.8);
    expect(await page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0)).toBeLessThan(5.2);
  });

  test("a failed job shows its stored error, not a fake success (criterion 4)", async ({ page }) => {
    const id = await seedSession(3);
    setJob(id, "failed", "detecting", 0.4, "ffmpeg exited with code 1");

    await page.goto(`/sessions/${id}`);
    await expect(page.locator("[data-ingest]")).toHaveAttribute("data-ingest-state", "failed");
    await expect(page.locator("[data-ingest]").getByRole("alert")).toContainText("ffmpeg exited with code 1");
    await expect(page.locator("[data-segment-timeline]")).toHaveCount(0);
  });

  test("a done job with no speech says so quietly (criterion 4)", async ({ page }) => {
    const id = await seedSession(3);
    setJob(id, "done", "done", 1); // done, zero segments

    await page.goto(`/sessions/${id}`);
    await expect(page.locator("[data-ingest]")).toHaveAttribute("data-ingest-state", "done");
    await expect(page.getByText("No speech detected in this recording.")).toBeVisible();
    await expect(page.locator("[data-segment-timeline]")).toHaveCount(0);
  });
});
