import { test, expect } from "@playwright/test";

// Mic capture end to end (E-2 part 2), driven by Chromium's fake audio device
// (--use-fake-device-for-media-stream / --use-fake-ui-for-media-stream, set in
// playwright.config.ts). These exercise the browser wiring the Node unit tests
// can't reach: getUserMedia, MediaRecorder timeslices, the AnalyserNode meter,
// and the POST to the real ingestion endpoint.
//
// [E-42 criterion 1] Stop no longer uploads behind the learner's back. Exactly ONE
// deliberate confirmation stands between a finished take and a running pipeline —
// keep it or discard it — and nothing follows it. These specs are the only place the
// keep/discard flow can be driven for real, since it needs MediaRecorder.

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

    // ONE confirmation, carrying the take's length — and nothing has been uploaded yet.
    const confirm = page.locator("[data-take-confirm]");
    await expect(confirm).toBeVisible({ timeout: 20_000 });
    await expect(confirm.locator("[data-take-duration]")).toHaveText(/\d+:\d\d/);
    // Exactly two choices, and no third step hiding behind either of them.
    await expect(confirm.locator("button")).toHaveCount(2);
    expect(await page.locator("[data-session-row]").count()).toBe(0);

    await page.locator("[data-keep-take]").click();

    // After assembly + upload + refresh, the new take is in the list, carrying
    // the sensible default name a mic take gets (RETRO-001).
    const row = page.locator("[data-session-row]").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toHaveAttribute("data-in-flight", "true");
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
    // The confirmation degrades to a fade too, and is still the one decision.
    await expect(page.locator("[data-take-confirm]")).toBeVisible({ timeout: 20_000 });
    await page.locator("[data-discard-take]").click();
  });

  test("discarding a take uploads nothing at all (criterion 1)", async ({ page }) => {
    await page.goto("/");
    const before = await page.locator("[data-session-row]").count();

    await page.getByRole("button", { name: "Record" }).click();
    await page.waitForTimeout(1600);
    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.locator("[data-take-confirm]")).toBeVisible({ timeout: 20_000 });
    await page.locator("[data-discard-take]").click();

    // Back to idle, and no session was created — "discard" means the audio never
    // left the browser, not that it was uploaded and then deleted.
    await expect(page.locator("[data-take-confirm]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Record" })).toBeEnabled();
    await page.waitForTimeout(2000);
    expect(await page.locator("[data-session-row]").count()).toBe(before);
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
