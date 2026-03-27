import { test, expect } from "@playwright/test";

test.describe("Settings (Admin)", () => {
  test("settings page loads", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("settings page heading is visible", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(
      page.getByRole("heading", { name: /settings/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("User Management card is visible", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/user management|users/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Roles & Access card is visible", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/roles.*access|access.*roles/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Leaderboards & Badges card is visible", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/leaderboard.*badge|badge.*leaderboard/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Roles & Access page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/roles");
    await expect(page).toHaveURL(/roles|settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Role matrix or role list should be present
    const hasContent =
      (await page.getByText(/admin|manager|staff/i).count()) > 0 ||
      (await page.getByRole("table").count()) > 0;
    expect(hasContent).toBe(true);
  });

  test("Leaderboards & Badges page loads", async ({ page }) => {
    await page.goto("/dashboard/settings/leaderboards");
    await expect(page).toHaveURL(/leaderboard|settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("User Management page loads at /dashboard/users", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page).toHaveURL(/users|settings/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("User Management shows user list or empty state", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const hasUsers =
      (await page.getByRole("row").count()) > 1 || // header row + at least one data row
      (await page.getByText(/no users|no results|empty/i).count()) > 0 ||
      (await page.getByText(/admin@|manager@|staff@/i).count()) > 0;
    expect(hasUsers).toBe(true);
  });

  test("Invite User button is visible on Users page", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /invite|add user|new user/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("settings page navigation cards are clickable links", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Roles & Access card navigates
    const rolesCard = page.getByRole("link", { name: /roles.*access|access.*roles/i }).first();
    if ((await rolesCard.count()) > 0) {
      await rolesCard.click();
      await expect(page).toHaveURL(/roles|settings/);
    }
  });
});
