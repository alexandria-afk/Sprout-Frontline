import { test, expect } from "@playwright/test";

test.describe("Sidekick (AI) Features", () => {
  test("Sidekick Insights card is visible on Insights page", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page.getByText("Sidekick Insights")).toBeVisible({ timeout: 10_000 });
  });

  test("Workflows page shows Generate with Sidekick", async ({ page }) => {
    await page.goto("/dashboard/workflows");
    // "Generate with Sidekick" lives inside the New Workflow modal — open it first
    await page.getByRole("button", { name: /new workflow/i }).click();
    // The modal shows 3 options; Sidekick subtitle is always visible (not text-transparent)
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Forms page shows Generate with Sidekick option", async ({ page }) => {
    await page.goto("/dashboard/forms");
    // "New Template" button only appears on the Templates tab — navigate there first
    await page.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Issues categories page shows Generate with Sidekick", async ({ page }) => {
    await page.goto("/dashboard/issues/categories");
    // "Generate with Sidekick" lives inside the New Category modal — open it first
    await page.getByRole("button", { name: /new category/i }).click();
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Maintenance guides page shows Generate with Sidekick", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Daily Brief shows gradient Sidekick card on dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Your Daily Brief by Sidekick")).toBeVisible();
    // The gradient border element should exist (check the parent div has inline style)
    const card = page.locator("div[style*='linear-gradient']").first();
    await expect(card).toBeVisible({ timeout: 10_000 });
  });

  test("No page still says 'AI' (should say Sidekick)", async ({ page }) => {
    const pagesToCheck = [
      "/dashboard",
      "/dashboard/workflows",
      "/dashboard/forms",
      "/dashboard/insights",
    ];
    for (const path of pagesToCheck) {
      await page.goto(path);
      await page.waitForTimeout(1000);
      // Check that "Generate with AI" or "AI Insights" exact old labels don't appear
      const oldText = await page.getByText("Generate with AI", { exact: true }).count();
      expect(oldText).toBe(0);
      const oldInsights = await page.getByText("AI Insights", { exact: true }).count();
      expect(oldInsights).toBe(0);
    }
  });
});
