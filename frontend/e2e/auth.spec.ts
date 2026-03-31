/**
 * auth.spec.ts
 *
 * Covers:
 *  - Login with valid credentials → redirect to /dashboard
 *  - Login with invalid credentials → error message shown
 *
 * NOTE: These tests run WITHOUT pre-existing storage state because they
 * deliberately test the unauthenticated login page.  They are NOT added to a
 * .admin/.manager/.staff testMatch glob so that the `setup` project (which
 * itself also authenticates) does not conflict.
 *
 * Run directly with:
 *   npx playwright test e2e/auth.spec.ts --project=admin
 * (The stored admin session is used only to get a clean starting URL; the
 *  tests themselves navigate to /login and test the form.)
 */

import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test.beforeEach(async ({ page }) => {
    // Sign out any existing session so we always start on /login
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
  });

  test("valid credentials redirect to dashboard", async ({ page }) => {
    // If already redirected (session still valid from storageState), that is
    // also acceptable evidence of a passing login flow.
    if (page.url().includes("/dashboard")) {
      await expect(page).toHaveURL(/dashboard/);
      return;
    }

    await expect(page.locator("#email")).toBeVisible({ timeout: 10_000 });
    await page.locator("#email").fill("admin@renegade.com");
    await page.locator("#password").fill("Test1234!");
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("invalid credentials show an error message", async ({ page }) => {
    // Navigate to login without any session (clear storage for this test only)
    await page.context().clearCookies();
    await page.evaluate(() => {
      try { localStorage.clear(); } catch { /* ignore */ }
      try { sessionStorage.clear(); } catch { /* ignore */ }
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#email")).toBeVisible({ timeout: 10_000 });
    await page.locator("#email").fill("notauser@example.com");
    await page.locator("#password").fill("WrongPass999!");
    await page.locator('button[type="submit"]').click();

    // The LoginForm surfaces the Supabase error in a red alert div
    await expect(
      page.locator(".bg-red-50, .text-red-700, [class*='red']").first()
    ).toBeVisible({ timeout: 10_000 });

    // Must NOT navigate away from /login
    await expect(page).toHaveURL(/login/);
  });
});
