import { test, expect } from "@playwright/test";

test.describe("Admin Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("sidebar loads without errors", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    const nav = page.locator("nav");
    await expect(nav).toBeVisible();
  });

  test("admin sidebar contains Dashboard link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /dashboard/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Tasks link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /tasks/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Issues link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /issues/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Forms link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /forms/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Training link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /training/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Workflows link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /workflows/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Announcements link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /announcements/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Shifts link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /shifts/i })
    ).toBeVisible();
  });

  test("admin sidebar contains Insights or Analytics link", async ({
    page,
  }) => {
    const insightsLink = page
      .locator("nav")
      .getByRole("link", { name: /insights|analytics/i });
    await expect(insightsLink).toBeVisible();
  });

  test("admin sidebar contains Settings link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /settings/i })
    ).toBeVisible();
  });

  test("all expected nav items are present in one pass", async ({ page }) => {
    const nav = page.locator("nav");
    const expectedLabels = [
      /dashboard/i,
      /tasks/i,
      /issues/i,
      /forms/i,
      /training/i,
      /workflows/i,
      /announcements/i,
      /shifts/i,
      /settings/i,
    ];
    for (const label of expectedLabels) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    // Insights/Analytics checked separately due to label variation
    const insightsVisible = await nav
      .getByRole("link", { name: /insights|analytics/i })
      .isVisible()
      .catch(() => false);
    expect(insightsVisible).toBe(true);
  });
});
