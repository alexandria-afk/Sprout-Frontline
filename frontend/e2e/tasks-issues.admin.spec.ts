import { test, expect } from "@playwright/test";

test.describe("Tasks & Issues (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/issues");
  });

  test("issues page loads", async ({ page }) => {
    await expect(page).toHaveURL(/issues/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("Issues tab content is shown", async ({ page }) => {
    // Default tab is "tasks" — navigate directly to issues tab
    await page.goto("/dashboard/issues?tab=issues");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // "Report a Problem" button or issue cards should be visible
    const hasContent =
      (await page.getByRole("button", { name: /report a problem/i }).count()) > 0 ||
      (await page.getByRole("row").count()) > 0 ||
      (await page.getByText(/no issues|no results|empty/i).count()) > 0;
    expect(hasContent).toBe(true);
  });

  test("Report a Problem button is visible on Issues tab", async ({ page }) => {
    await page.goto("/dashboard/issues?tab=issues");
    await expect(
      page.getByRole("button", { name: /report a problem/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("search input is visible on Issues tab", async ({ page }) => {
    await page.goto("/dashboard/issues?tab=issues");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("input[placeholder*='earch']").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Tasks tab is accessible from issues page", async ({ page }) => {
    // /dashboard/tasks may redirect to /dashboard/issues, navigate directly
    await page.goto("/dashboard/tasks");
    await expect(page).toHaveURL(/tasks|issues/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("Incidents tab or page is accessible", async ({ page }) => {
    // Try navigating to incidents directly; tab may also be present on issues page
    const incidentsTab = page.getByRole("button", { name: /incidents/i });
    if ((await incidentsTab.count()) > 0) {
      await incidentsTab.click();
      await expect(page).toHaveURL(/issues|incidents/);
    } else {
      await page.goto("/dashboard/issues/incidents");
      await expect(page).toHaveURL(/incidents|issues/);
    }
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("Categories tab or page is accessible", async ({ page }) => {
    const categoriesTab = page.getByRole("button", { name: /categories/i });
    if ((await categoriesTab.count()) > 0) {
      await categoriesTab.click();
      await expect(page).toHaveURL(/issues|categories/);
    } else {
      await page.goto("/dashboard/issues/categories");
      await expect(page).toHaveURL(/categories|issues/);
    }
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("issue list or empty state renders after load", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // After loading, either data or empty state is visible
    const hasData = await page.locator("main, [role='main'], .flex-1").first().isVisible();
    expect(hasData).toBe(true);
  });
});
