import { test, expect } from "@playwright/test";

test.describe("Role Access — Manager Privileges", () => {
  test("manager CAN access /dashboard/insights", async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page).toHaveURL(/insights/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });

  test("manager CAN access /dashboard/insights/reports/tasks", async ({
    page,
  }) => {
    await page.goto("/dashboard/insights/reports/tasks");
    await expect(page).toHaveURL(/tasks|reports|insights/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });

  test("manager CAN access /dashboard/shifts", async ({ page }) => {
    await page.goto("/dashboard/shifts");
    await expect(page).toHaveURL(/shifts/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });

  test("manager CAN access /dashboard/announcements and see New Announcement button", async ({
    page,
  }) => {
    await page.goto("/dashboard/announcements");
    await expect(page).toHaveURL(/announcements/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /new announcement/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("manager CANNOT access /dashboard/settings/roles", async ({ page }) => {
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

  test("manager CAN see New Template button on forms templates tab", async ({
    page,
  }) => {
    // Both admin and manager can create form templates (role check: role !== "staff")
    // Navigate directly to the templates tab — the button only renders when activeTab==="templates"
    await page.goto("/dashboard/forms?tab=templates");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const newTemplateBtn = page.getByRole("button", { name: /new template/i });
    await expect(newTemplateBtn).toBeVisible({ timeout: 15_000 });
  });

  test("manager CAN see their team's tasks (Tasks page loads)", async ({
    page,
  }) => {
    await page.goto("/dashboard/issues");
    await expect(page).toHaveURL(/issues|tasks/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).not.toContain("unauthorized");
    expect(page.url()).not.toContain("403");
  });
});
