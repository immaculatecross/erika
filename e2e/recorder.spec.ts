import { test, expect } from "@playwright/test";

// Mic capture end to end (E-2 part 2), driven by Chromium's fake audio device
// (--use-fake-device-for-media-stream / --use-fake-ui-for-media-stream, set in
// playwright.config.ts). These exercise the browser wiring the Node unit tests
// can't reach: getUserMedia, MediaRecorder timeslices, the AnalyserNode meter,
// and the POST to the real ingestion endpoint.

test.describe("mic capture", () => {
  test("record → stop → session lands with a queued job and non-zero duration (criteria 1, 2)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Record" }).click();

    // The live panel (timer + meter + Stop) is up while recording.
    const panel = page.locator("[data-recording]");
    await expect(panel).toBeVisible();
    await expect(page.locator("[data-level-meter]")).toBeVisible();

    // Record across several 1 s timeslices so the take is chunk-assembled, then stop.
    await page.waitForTimeout(2600);
    await page.getByRole("button", { name: "Stop" }).click();

    // After assembly + upload + refresh, the new take is in the list, carrying
    // the sensible default name a mic take gets (RETRO-001).
    const row = page.locator("[data-session-row]").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("Queued")).toBeVisible();
    await expect(row.getByText(/^Recording \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.wav$/)).toBeVisible();

    // Non-zero duration proves the chunks assembled into a decodable file that
    // ffprobe measured (not truncated to a single fragment).
    const meta = row.locator("[data-session-meta]");
    await expect(meta).not.toHaveText(/· 0:00$/);
    await expect(meta).toHaveText(/· \d+:\d\d(:\d\d)?$/);
  });

  test("meter degrades to a non-animated indicator under reduced motion (criterion 3)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Record" }).click();

    const meter = page.locator("[data-level-meter]");
    await expect(meter).toHaveAttribute("data-reduced-motion", "true");
    // The reduced bars carry no spring/transform; the animated variant is absent.
    await expect(meter.locator("[data-spring='false']").first()).toBeVisible();
    await expect(meter.locator("[data-spring='true']")).toHaveCount(0);

    await page.getByRole("button", { name: "Stop" }).click();
  });

  test("denied mic shows a quiet message and never breaks Upload (criterion 5)", async ({
    page,
  }) => {
    // Force getUserMedia to reject, as a blocked-permission browser would.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
        },
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Record" }).click();
    await expect(page.getByText("Microphone access is off.")).toBeVisible();

    // No live panel opened, nothing crashed, and Upload is still there.
    await expect(page.locator("[data-recording]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload audio" })).toBeVisible();
    // The recorder is not a dead control — it can be pressed again.
    await expect(page.getByRole("button", { name: "Record" })).toBeEnabled();
  });
});
