import { test, expect } from "@playwright/test";

test.describe("Manager Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("page loads without error", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("stat cards are visible", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Manager sees team-oriented stat cards (similar to admin)
    // At least some stat cards should be rendered
    const statCards = [
      /checklist completion|team open issues|pending acknowledgements|open caps|audit compliance/i,
    ];
    let found = false;
    for (const pattern of statCards) {
      if ((await page.getByText(pattern).count()) > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("Daily Brief by Sidekick renders", async ({ page }) => {
    await expect(page.getByText("Your Daily Brief by Sidekick")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("My Inbox widget renders", async ({ page }) => {
    await expect(page.getByText("My Inbox")).toBeVisible({ timeout: 15_000 });
  });

  test("My Inbox widget renders (second check)", async ({ page }) => {
    // Dashboard renders "My Inbox" for all roles — not "Tasks Overview"
    await expect(page.getByText("My Inbox")).toBeVisible({ timeout: 15_000 });
  });

  test("stat card links navigate correctly", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Clicking a team-stat card should navigate to the relevant module
    const issuesCard = page.getByText("Team Open Issues");
    if ((await issuesCard.count()) > 0) {
      await issuesCard.click();
      await expect(page).toHaveURL(/issues/);
      await page.goBack();
    }
  });

  test("Pending Acknowledgements stat navigates to announcements", async ({
    page,
  }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const ackCard = page.getByText("Pending Acknowledgements");
    if ((await ackCard.count()) > 0) {
      await ackCard.click();
      await expect(page).toHaveURL(/announcements/);
      await page.goBack();
    }
  });

  test("sidebar navigation is present", async ({ page }) => {
    // Sidebar nav links should be visible for manager
    await expect(page.getByRole("navigation")).toBeVisible({ timeout: 10_000 });
  });

  test("manager does not see Settings link in nav", async ({ page }) => {
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Settings is an admin-only section; manager should not have it in nav
    const settingsNavLink = page.getByRole("link", { name: /^settings$/i });
    const count = await settingsNavLink.count();
    // Either not present, or if present should verify behavior
    // We just assert it's not a nav item (count 0 expected)
    expect(count).toBe(0);
  });
});
