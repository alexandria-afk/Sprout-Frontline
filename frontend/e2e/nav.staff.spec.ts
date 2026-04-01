import { test, expect } from "@playwright/test";

test.describe("Staff Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("staff sidebar contains Dashboard link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /dashboard/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Tasks link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /tasks/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Issues link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /issues/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Forms link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /forms/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Training link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /training/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Announcements link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /announcements/i })
    ).toBeVisible();
  });

  test("staff sidebar contains Shifts link", async ({ page }) => {
    await expect(
      page.locator("nav").getByRole("link", { name: /shifts/i })
    ).toBeVisible();
  });

  test("staff sidebar does NOT contain Settings link", async ({ page }) => {
    const settingsLink = page.locator("nav a[href*='settings']");
    await expect(settingsLink).not.toBeVisible();
  });

  test("staff sidebar does NOT contain Insights or Analytics link", async ({
    page,
  }) => {
    const insightsVisible = await page
      .locator("nav")
      .getByRole("link", { name: /insights|analytics/i })
      .isVisible()
      .catch(() => false);
    expect(insightsVisible).toBe(false);
  });

  test("staff sidebar does NOT contain Workflows link", async ({ page }) => {
    const workflowsVisible = await page
      .locator("nav")
      .getByRole("link", { name: /workflows/i })
      .isVisible()
      .catch(() => false);
    expect(workflowsVisible).toBe(false);
  });

  test("staff sidebar does NOT contain Users link", async ({ page }) => {
    const usersLink = page.locator("nav a[href*='/dashboard/users']");
    const usersVisible = await usersLink.isVisible().catch(() => false);
    expect(usersVisible).toBe(false);
  });

  test("staff sidebar only shows permitted nav items", async ({ page }) => {
    const nav = page.locator("nav");

    // These must be present
    const requiredLabels = [
      /dashboard/i,
      /tasks/i,
      /issues/i,
      /forms/i,
      /training/i,
      /announcements/i,
      /shifts/i,
    ];
    for (const label of requiredLabels) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    // These must be absent
    await expect(nav.locator("a[href*='settings']")).not.toBeVisible();
    const insightsVisible = await nav
      .getByRole("link", { name: /insights|analytics/i })
      .isVisible()
      .catch(() => false);
    expect(insightsVisible).toBe(false);

    const workflowsVisible = await nav
      .getByRole("link", { name: /workflows/i })
      .isVisible()
      .catch(() => false);
    expect(workflowsVisible).toBe(false);
  });
});
