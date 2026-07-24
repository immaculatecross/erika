import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { openDatabase } from "../lib/db";
import { createSession } from "../lib/sessions";
import { upsertSegment } from "../lib/segments";
import { enqueueAnalysis } from "../lib/analysis/cascade";
import { persistSegmentFindings, type Category, type Severity } from "../lib/analysis/findings";
import { recordSpend } from "../lib/analysis/budget";
import { writeSettings } from "../lib/settings";
import { ensureSessionDir, sourcePath } from "../lib/audio-storage";

// The analysis report UI end to end (E-4 part 2), driving the same throwaway
// DB/data dir the dev server uses (playwright.config env). We seed sessions,
// segments, analysis-job rows and findings directly — the worker isn't run; the
// page only reflects state — then mutate rows to prove the pre-run estimate/budget
// gate, the live no-reload progress, the report, and every truthful terminal state.

process.env.ERIKA_DATA_DIR = process.env.ERIKA_DATA_DIR ?? ".playwright/e2e-data";
const DB_PATH = process.env.ERIKA_DB_PATH ?? ".playwright/e2e.db";

function db() {
  return openDatabase(DB_PATH);
}

/** Seed a session with a real playable WAV of `seconds`. */
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

/** Create an analysis job for a session and force it to `state`/`progress`. */
function setAnalysisJob(id: string, state: string, stage: string | null, progress: number, error: string | null = null) {
  const job = enqueueAnalysis(db(), id);
  db()
    .prepare("UPDATE analysis_jobs SET state=?, stage=?, progress=?, error=? WHERE id=?")
    .run(state, stage, progress, error, job.id);
}

function addFinding(
  id: string,
  o: { category: Category; severity: Severity; startMs: number; endMs: number; quote?: string; correction?: string },
) {
  persistSegmentFindings(db(), {
    sessionId: id,
    contentHash: `${id}-f-${o.startMs}`,
    flagged: true,
    deepDone: true,
    findings: [
      {
        quote: o.quote ?? "your phrase",
        correction: o.correction ?? "the recast",
        category: o.category,
        explanation: "why this reads as non-native",
        severity: o.severity,
        startMs: o.startMs,
        endMs: o.endMs,
      },
    ],
  });
}

function countAnalysisJobs(id: string): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE session_id=?").get(id) as { n: number }).n;
}

test.describe("analysis UI", () => {
  test("Analyze shows the pre-run estimate and remaining budget, then confirming starts the run (criterion 1)", async ({
    page,
  }) => {
    const id = await seedSession(4);
    addSegment(id, 0, 0, 60_000); // one pending segment → a positive estimate

    await page.goto(`/sessions/${id}`);
    const panel = page.locator("[data-analysis]");
    await expect(panel).toHaveAttribute("data-analysis-state", "idle");

    await page.locator("[data-analyze]").click();

    // The estimate figure and remaining budget come from the estimate endpoint.
    await expect(page.locator("[data-figure='estimate-total']")).toBeVisible();
    await expect(page.locator("[data-figure='estimate-total']")).toContainText("$");
    await expect(page.locator("[data-figure='remaining']")).toContainText("$");
    expect(countAnalysisJobs(id)).toBe(0); // nothing enqueued just from estimating

    await page.locator("[data-confirm-analyze]").click();

    // Confirming issued the POST: a job now exists and the orb picks it up.
    await expect(panel).toHaveAttribute("data-analysis-state", "queued", { timeout: 10_000 });
    await expect(page.locator("[data-analysis-progress]")).toBeVisible();
    expect(countAnalysisJobs(id)).toBe(1);
  });

  test("a session at its budget shows a truthful 'budget reached' state and never starts a run (criterion 1)", async ({
    page,
  }) => {
    const id = await seedSession(4);
    addSegment(id, 0, 0, 60_000);
    writeSettings(db(), { monthlyBudgetUsd: 1 });
    recordSpend(db(), { model: "gpt-audio-1.5", contentHash: "x", costUsd: 1 }); // month is full

    await page.goto(`/sessions/${id}`);
    await page.locator("[data-analyze]").click();

    await expect(page.locator("[data-budget-reached]")).toBeVisible();
    await expect(page.locator("[data-budget-reached]")).toContainText("budget reached");
    await expect(page.locator("[data-confirm-analyze]")).toHaveCount(0); // no way to start
    expect(countAnalysisJobs(id)).toBe(0); // nothing enqueued
  });

  test("live progress advances to done without a reload, then polling stops (criterion 2)", async ({ page }) => {
    const id = await seedSession(6);
    setAnalysisJob(id, "processing", "analyzing", 0.5);

    await page.goto(`/sessions/${id}`);
    const panel = page.locator("[data-analysis]");
    await expect(panel).toHaveAttribute("data-analysis-state", "processing");
    await expect(page.locator("[data-analysis-progress]")).toHaveAttribute("data-progress-pct", "50");
    await expect(panel).toHaveAttribute("data-polling", "true");

    // Mark the live document so a reload (which would clear it) is detectable.
    await page.evaluate(() => ((window as unknown as { __mark: number }).__mark = 1));

    // The worker would do this; we do it directly. The page must react by polling.
    db().prepare("UPDATE analysis_jobs SET state='done', stage='done', progress=1 WHERE session_id=?").run(id);
    addFinding(id, { category: "grammar", severity: "medium", startMs: 1000, endMs: 2000 });

    await expect(panel).toHaveAttribute("data-analysis-state", "done", { timeout: 10_000 });
    await expect(page.locator("[data-analysis-report]")).toBeVisible();
    await expect(panel).toHaveAttribute("data-polling", "false");

    // Same document — no navigation happened.
    expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(1);

    // Polling truly stopped: the fetch count is frozen after the terminal state.
    const count = await panel.getAttribute("data-poll-count");
    await page.waitForTimeout(2500); // > two poll intervals
    expect(await panel.getAttribute("data-poll-count")).toBe(count);
  });

  test("the report shows per-category counts; a finding expands in place and jump-to-audio seeks the player (criterion 3)", async ({
    page,
  }) => {
    const id = await seedSession(8);
    setAnalysisJob(id, "done", "done", 1);
    addFinding(id, { category: "grammar", severity: "high", startMs: 5000, endMs: 6000, quote: "he go", correction: "he goes" });
    addFinding(id, { category: "grammar", severity: "low", startMs: 1000, endMs: 2000 });
    addFinding(id, { category: "idiom", severity: "medium", startMs: 3000, endMs: 4000 });

    await page.goto(`/sessions/${id}`);
    await expect(page.locator("[data-analysis]")).toHaveAttribute("data-analysis-state", "done");

    // Per-category counts across the five categories.
    await expect(page.locator("[data-category-count='grammar']")).toContainText("2");
    await expect(page.locator("[data-category-count='idiom']")).toContainText("1");
    await expect(page.locator("[data-category-count='vocabulary']")).toContainText("0");
    await expect(page.locator("[data-category-count='pronunciation']")).toContainText("0");

    // Findings render in timeline order — the first starts at 1000ms.
    const findings = page.locator("[data-finding]");
    await expect(findings).toHaveCount(3);
    const first = findings.first();
    await expect(first).toHaveAttribute("data-expanded", "false");
    await expect(first.locator("[data-finding-detail]")).toHaveCount(0); // collapsed
    // Correction-forward (E-29): the collapsed row leads with the correction, and the
    // error is not shown until the row is expanded.
    await expect(first.locator("[data-finding-correction]")).toContainText("the recast");
    await expect(first).not.toContainText("your phrase");

    await first.locator("button").first().click(); // expand in place
    await expect(first).toHaveAttribute("data-expanded", "true");
    await expect(first.locator("[data-finding-detail]")).toBeVisible();
    // The error is shown once, marked, beneath the correction (the one confrontation).
    await expect(first.locator("[data-finding-error]")).toContainText("your phrase");

    // Wait for the player to have metadata so a seek sticks, then jump.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.readyState ?? 0))
      .toBeGreaterThanOrEqual(1);
    await first.locator("[data-jump]").click(); // this finding starts at 1000ms
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0))
      .toBeGreaterThan(0.8);
    expect(await page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0)).toBeLessThan(1.2);
  });

  test("terminal states each say their truthful thing: halted, failed, and done-with-zero (criterion 4)", async ({
    page,
  }) => {
    // halted — a truthful budget message.
    const halted = await seedSession(3);
    setAnalysisJob(halted, "halted", "analyzing", 0.4, "Monthly budget reached.");
    await page.goto(`/sessions/${halted}`);
    await expect(page.locator("[data-analysis]")).toHaveAttribute("data-analysis-state", "halted");
    await expect(page.locator("[data-analysis]").getByRole("status")).toContainText("Monthly budget reached");

    // failed — its stored error, not a fake success.
    const failed = await seedSession(3);
    setAnalysisJob(failed, "failed", "analyzing", 0.4, "gpt-audio call failed: 500");
    await page.goto(`/sessions/${failed}`);
    await expect(page.locator("[data-analysis]")).toHaveAttribute("data-analysis-state", "failed");
    await expect(page.locator("[data-analysis]").getByRole("alert")).toContainText("gpt-audio call failed: 500");

    // done with zero findings — a quiet, specific line (never "Great!").
    const clean = await seedSession(3);
    setAnalysisJob(clean, "done", "done", 1);
    await page.goto(`/sessions/${clean}`);
    await expect(page.locator("[data-analysis]")).toHaveAttribute("data-analysis-state", "done");
    await expect(page.getByText("No errors found in this session")).toBeVisible();
    await expect(page.locator("[data-analysis-report]")).toHaveCount(0);
  });
});
