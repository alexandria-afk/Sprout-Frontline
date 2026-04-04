import { test, expect } from "@playwright/test";

test.describe("Staff Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("page loads and shows staff greeting", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    // Staff sees a greeting card with their name
    const greetings = ["Good morning", "Good afternoon", "Good evening"];
    let found = false;
    for (const g of greetings) {
      if (await page.getByText(new RegExp(g, "i")).isVisible()) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("Daily Brief by Sidekick is NOT shown for staff (admin/manager only)", async ({ page }) => {
    // The Daily Brief widget is only rendered for admin and manager roles
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
    const briefVisible = await page.getByText("Your Daily Brief by Sidekick").isVisible().catch(() => false);
    expect(briefVisible).toBe(false);
  });

  test("staff stat cards visible", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Overdue Items")).toBeVisible();
    await expect(page.getByText("Open Issues")).toBeVisible();
    await expect(page.getByText("Courses to Complete")).toBeVisible();
    await expect(page.getByText("Shifts This Week")).toBeVisible();
  });

  test("My Inbox renders for staff", async ({ page }) => {
    await expect(page.getByText("My Inbox")).toBeVisible({ timeout: 15_000 });
  });

  test("staff sees My Inbox widget", async ({ page }) => {
    // Staff dashboard shows My Inbox (not a separate Achievements widget)
    await expect(page.getByText("My Inbox")).toBeVisible({ timeout: 15_000 });
  });
});
