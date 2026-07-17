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
      // Exactly three nav items.
      const links = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
      await expect(links).toHaveCount(3);
    });
  }

  test("marks the active nav item", async ({ page }) => {
    await page.goto("/practice");
    const active = page.locator('nav[aria-label="Primary"] a[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText("Practice");
  });

  test("empty states show one sentence and one action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
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
