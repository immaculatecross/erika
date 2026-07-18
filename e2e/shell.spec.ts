import { test, expect } from "@playwright/test";

test.describe("shell & routes", () => {
  const routes = [
    { path: "/", heading: "Sessions" },
    { path: "/practice", heading: "Practice" },
    { path: "/settings", heading: "Settings" },
  ];

  for (const { path, heading } of routes) {
    test(`renders ${path} with the sidebar and heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      // Five nav items: Sessions, Practice, Focus (E-7), Phrasebook (E-9), Settings.
      const links = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
      await expect(links).toHaveCount(5);
    });
  }

  test("marks the active nav item", async ({ page }) => {
    await page.goto("/practice");
    const active = page.locator('nav[aria-label="Primary"] a[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText("Practice");
  });

  test("the sessions empty state shows its capture actions and no illustration", async ({
    page,
  }) => {
    await page.goto("/");
    // Capture (E-2) offers two ways in: record from the mic or upload a file.
    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload audio" })).toBeVisible();
    await expect(page.locator("img")).toHaveCount(0); // no illustration
  });
});

test.describe("reduced motion", () => {
  test("takes the opacity-only branch", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("[data-page-transition]")).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
  });
});
