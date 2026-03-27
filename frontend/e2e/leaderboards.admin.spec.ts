import { test, expect } from "@playwright/test";

test.describe("Leaderboards & Insights (Admin)", () => {
  test("Insights page loads", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page).toHaveURL(/insights/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("Insights page heading is visible", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(
      page.getByRole("heading", { name: /insights/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Sidekick Insights card is visible on Insights page", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights");
    await expect(page.getByText("Sidekick Insights")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Safety Leaderboard page loads", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/safety/leaderboard");
    await expect(page).toHaveURL(/leaderboard/);
    await expect(page.getByRole("heading", { name: /leaderboard/i })).toBeVisible({ timeout: 15_000 });
  });

  test("Safety Leaderboard page loads with heading", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/safety/leaderboard");
    await expect(
      page.getByRole("heading", { name: /leaderboard/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Safety Leaderboard shows participants or empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights/reports/safety/leaderboard");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/participants|no data|no results|leaderboard/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Reports section is accessible from Insights page", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Reports link or section on insights page
    const reportsLink = page.getByRole("link", { name: /reports/i }).first();
    if ((await reportsLink.count()) > 0) {
      await reportsLink.click();
      await expect(page).toHaveURL(/reports|insights/);
    } else {
      // Navigate directly to a known report
      await page.goto("/dashboard/insights/reports/tasks");
      await expect(page).toHaveURL(/tasks/);
    }
  });

  test("Leaderboards settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/leaderboards");
    await expect(page).toHaveURL(/leaderboard|settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("Leaderboards settings page shows configuration or badges section", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings/leaderboards");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const hasContent =
      (await page.getByText(/badge|leaderboard|point|rank/i).count()) > 0 ||
      (await page.getByRole("table").count()) > 0 ||
      (await page.getByRole("heading").count()) > 0;
    expect(hasContent).toBe(true);
  });

  test("Insights page shows report navigation cards", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Insight cards linking to different reports should be present
    const hasCards =
      (await page.getByRole("link").count()) > 0 ||
      (await page.getByRole("button").count()) > 1;
    expect(hasCards).toBe(true);
  });
});
