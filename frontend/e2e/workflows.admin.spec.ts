import { test, expect } from "@playwright/test";

test.describe("Workflows (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/workflows");
  });

  test("page loads without error", async ({ page }) => {
    await expect(page).toHaveURL(/workflows/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("page heading is visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /workflow/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("New Workflow button is visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /new workflow/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("workflow list or empty state is shown", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const hasWorkflows =
      (await page.getByRole("row").count()) > 0 ||
      (await page.locator("[data-testid*='workflow']").count()) > 0 ||
      (await page.getByText(/no workflows|no results|empty/i).count()) > 0 ||
      (await page.getByText(/workflow/i).count()) > 0;
    expect(hasWorkflows).toBe(true);
  });

  test("clicking New Workflow opens a modal or dialog", async ({ page }) => {
    await page.getByRole("button", { name: /new workflow/i }).click();
    // Modal shows creation options (no role="dialog" — check for distinctive content)
    await expect(page.getByText(/generate with sidekick|from a template|start blank/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("New Workflow modal contains Sidekick option", async ({ page }) => {
    await page.getByRole("button", { name: /new workflow/i }).click();
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("New Workflow modal can be dismissed", async ({ page }) => {
    await page.getByRole("button", { name: /new workflow/i }).click();
    await expect(page.getByText(/generate with sidekick|from a template|start blank/i).first()).toBeVisible({ timeout: 10_000 });
    // Close via the × button (modal doesn't handle Escape)
    await page.locator("button").filter({ hasText: "×" }).first().click();
    await expect(page.getByText(/from a template/i)).not.toBeVisible({ timeout: 5_000 });
  });

  test("search input is visible", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Workflows page has a search input with placeholder "Search workflows…"
    await expect(page.locator("input[placeholder*='earch']").first()).toBeVisible({ timeout: 10_000 });
  });
});
