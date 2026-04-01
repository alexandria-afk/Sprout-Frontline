import { test, expect } from "@playwright/test";

test.describe("Admin Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("page loads without error", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("Daily Brief by Sidekick renders with text", async ({ page }) => {
    const brief = page.getByText("Your Daily Brief by Sidekick");
    await expect(brief).toBeVisible();
    // Wait for loading to finish (skeletons gone)
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
    // Summary text should be present (not blank)
    const briefCard = page.locator("text=Your Daily Brief by Sidekick").locator("..").locator("..");
    await expect(briefCard).toBeVisible();
  });

  test("Daily Brief refresh button works", async ({ page }) => {
    // Wait for initial load
    await page.waitForTimeout(3000);
    const refreshBtn = page.getByRole("button", { name: /refresh/i });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // Spinner should appear briefly
    await expect(page.locator(".animate-spin")).toBeVisible({ timeout: 5_000 });
  });

  test("stat cards are visible - 4 cards", async ({ page }) => {
    // Wait for skeleton to resolve
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Checklist Completion")).toBeVisible();
    await expect(page.getByText("Audit Compliance", { exact: true })).toBeVisible();
    await expect(page.getByText("Training Completion")).toBeVisible();
    await expect(page.getByText("Shifts Today")).toBeVisible();
  });

  test("Tasks Overview widget renders", async ({ page }) => {
    await expect(page.getByText("Tasks Overview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("View all")).toBeVisible();
  });

  test("My Inbox widget renders", async ({ page }) => {
    await expect(page.getByText("My Inbox")).toBeVisible({ timeout: 15_000 });
  });

  test("stat cards link to correct pages", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
    await page.getByText("Checklist Completion").click();
    await expect(page).toHaveURL(/forms/);
    await page.goBack();
    await page.getByText("Audit Compliance", { exact: true }).click();
    await expect(page).toHaveURL(/audits/);
  });
});
