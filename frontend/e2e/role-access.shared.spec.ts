import { test, expect } from "@playwright/test";

test.describe("Role Access Control", () => {
  test("dashboard is accessible", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("tasks page is accessible", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    // /dashboard/tasks redirects to /dashboard/issues
    await expect(page).toHaveURL(/tasks|issues/);
  });

  test("issues page is accessible", async ({ page }) => {
    await page.goto("/dashboard/issues");
    await expect(page).toHaveURL(/issues/);
  });

  test("forms page is accessible", async ({ page }) => {
    await page.goto("/dashboard/forms");
    await expect(page).toHaveURL(/forms/);
  });

  test("announcements page is accessible", async ({ page }) => {
    await page.goto("/dashboard/announcements");
    await expect(page).toHaveURL(/announcements/);
  });
});
