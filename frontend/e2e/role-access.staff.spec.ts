import { test, expect } from "@playwright/test";

test.describe("Role Access — Staff Restrictions", () => {
  test("staff is redirected away from /dashboard/settings", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Should either redirect away or show access denied — not stay on settings
    const url = page.url();
    const hasAccessDenied = await page
      .getByText(/access denied|unauthorized|forbidden|not allowed/i)
      .isVisible()
      .catch(() => false);
    const redirectedAway = !url.includes("settings");
    expect(redirectedAway || hasAccessDenied).toBe(true);
  });

  test("staff is redirected away from /dashboard/users", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const url = page.url();
    const hasAccessDenied = await page
      .getByText(/access denied|unauthorized|forbidden|not allowed/i)
      .isVisible()
      .catch(() => false);
    const redirectedAway = !url.includes("users");
    expect(redirectedAway || hasAccessDenied).toBe(true);
  });

  test("staff is redirected away from /dashboard/insights", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const url = page.url();
    const hasAccessDenied = await page
      .getByText(/access denied|unauthorized|forbidden|not allowed/i)
      .isVisible()
      .catch(() => false);
    const redirectedAway = !url.includes("insights");
    expect(redirectedAway || hasAccessDenied).toBe(true);
  });

  test("staff is redirected away from /dashboard/settings/roles", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings/roles");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const url = page.url();
    const hasAccessDenied = await page
      .getByText(/access denied|unauthorized|forbidden|not allowed/i)
      .isVisible()
      .catch(() => false);
    const redirectedAway = !url.includes("roles");
    expect(redirectedAway || hasAccessDenied).toBe(true);
  });

  test("staff is redirected away from /dashboard/issues/categories", async ({
    page,
  }) => {
    await page.goto("/dashboard/issues/categories");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const url = page.url();
    const hasAccessDenied = await page
      .getByText(/access denied|unauthorized|forbidden|not allowed/i)
      .isVisible()
      .catch(() => false);
    const redirectedAway = !url.includes("categories");
    expect(redirectedAway || hasAccessDenied).toBe(true);
  });

  test("staff cannot see Settings link in sidebar nav", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const settingsLink = page.locator("nav a[href*='settings']");
    await expect(settingsLink).not.toBeVisible();
  });

  test("staff cannot see Insights link in sidebar nav", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const insightsLink = page.locator("nav a[href*='insights']");
    const analyticsLink = page.getByRole("link", { name: /insights|analytics/i });
    const insightsVisible = await insightsLink.isVisible().catch(() => false);
    const analyticsVisible = await analyticsLink.isVisible().catch(() => false);
    expect(insightsVisible || analyticsVisible).toBe(false);
  });

  test("staff CAN access /dashboard/tasks", async ({ page }) => {
    await page.goto("/dashboard/issues");
    await expect(page).toHaveURL(/issues|tasks/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });

  test("staff CAN access /dashboard/forms", async ({ page }) => {
    await page.goto("/dashboard/forms");
    await expect(page).toHaveURL(/forms/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });

  test("staff CAN access /dashboard/shifts", async ({ page }) => {
    await page.goto("/dashboard/shifts");
    await expect(page).toHaveURL(/shifts/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });
});
