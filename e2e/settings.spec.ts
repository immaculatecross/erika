import { test, expect } from "@playwright/test";

test.describe("settings persistence", () => {
  test("set → reload → values survive", async ({ page }) => {
    await page.goto("/settings");
    const target = page.getByLabel("Target language");
    await expect(target).toBeVisible();

    await target.fill("Portuguese");
    await page.getByRole("button", { name: "deep" }).click();
    await page.getByLabel("Monthly budget (USD)").fill("33");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await page.reload();
    await expect(page.getByLabel("Target language")).toHaveValue("Portuguese");
    await expect(page.getByLabel("Monthly budget (USD)")).toHaveValue("33");
    await expect(page.getByRole("button", { name: "deep" })).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  test("rejects an invalid budget with a truthful message", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Monthly budget (USD)")).toBeVisible();
    await page.getByLabel("Monthly budget (USD)").fill("not a number");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("must be a number of dollars")).toBeVisible();
  });
});
