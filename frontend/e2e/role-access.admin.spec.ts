import { test, expect } from "@playwright/test";

test.describe("Role Access — Admin Privileges", () => {
  test("admin can access /dashboard/settings", async ({ page }) => {
    await page.goto("/dashboard/settings");
    // Should load settings, not redirect to 403/dashboard
    await expect(page).toHaveURL(/settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Should NOT be redirected away to dashboard root
    expect(page.url()).toContain("settings");
  });

  test("admin can access /dashboard/users", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page).toHaveURL(/users/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).toContain("users");
  });

  test("admin can see New Template button on Forms Templates tab", async ({
    page,
  }) => {
    await page.goto("/dashboard/forms");
    await page.getByRole("button", { name: "Templates" }).click();
    await expect(
      page.getByRole("button", { name: /new template/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can see New Workflow button on Workflows page", async ({
    page,
  }) => {
    await page.goto("/dashboard/workflows");
    await expect(
      page.getByRole("button", { name: /new workflow/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can see New Announcement button", async ({ page }) => {
    await page.goto("/dashboard/announcements");
    await expect(
      page.getByRole("button", { name: /new announcement/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can access Roles & Access settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/roles");
    await expect(page).toHaveURL(/roles|settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Should not redirect to dashboard
    expect(page.url()).not.toMatch(/^http:\/\/localhost:3000\/dashboard$/);
  });

  test("admin can access Insights page", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page).toHaveURL(/insights/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("admin can access maintenance guides", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page).toHaveURL(/guides|maintenance/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("admin can access issues categories page", async ({ page }) => {
    await page.goto("/dashboard/issues/categories");
    await expect(page).toHaveURL(/categories|issues/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("admin can access all reports", async ({ page }) => {
    const reportPaths = [
      "/dashboard/insights/reports/tasks",
      "/dashboard/insights/reports/issues/summary",
      "/dashboard/insights/reports/operations/caps",
      "/dashboard/insights/reports/operations/checklists",
    ];
    for (const path of reportPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.split("/").pop()!));
      // Should not bounce to unauthorized
      expect(page.url()).not.toContain("unauthorized");
      expect(page.url()).not.toContain("403");
    }
  });
});
