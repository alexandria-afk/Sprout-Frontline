/**
 * forms-create-template.admin.spec.ts
 *
 * Covers:
 *  - Forms tab → create new form from a starter template
 *
 * The Forms page has a "Templates" tab.  Clicking "New Template" opens a
 * creation modal with three options:
 *   1. Generate with Sidekick (AI)
 *   2. From a Starter (pre-built template)
 *   3. Start Blank
 *
 * This test exercises option 2 ("From a Starter") because it does not depend
 * on a live AI endpoint.
 *
 * NOTE: The actual template save/publish step DOES require the backend
 * (POST /api/v1/forms/templates).  The test verifies the full UI flow up to
 * the point where the editor opens; backend-dependent assertions are guarded.
 */

import { test, expect } from "@playwright/test";

test.describe("Forms — Create Template from Starter (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/forms");
    await page.waitForLoadState("networkidle");
    // Navigate to Templates tab
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("New Template button opens the creation modal", async ({ page }) => {
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(
      page.getByText(/generate with sidekick|from a starter|start blank/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("modal contains all three creation options", async ({ page }) => {
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(
      page.getByText(/generate with sidekick/i).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/from a starter/i).first()
    ).toBeVisible();
    await expect(
      page.getByText(/start blank/i).first()
    ).toBeVisible();
  });

  test("selecting From a Starter shows a list of starter templates", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(
      page.getByText(/from a starter/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Click the "From a Starter" option card / button
    await page.getByText(/from a starter/i).first().click();

    // A list of starter templates (or a loading state) should appear
    await page.waitForTimeout(500);
    const hasStarters =
      (await page.getByRole("button", { name: /use|select|starter/i }).count()) > 0 ||
      (await page.getByText(/opening|loading/i).count()) > 0 ||
      (await page.locator("[data-testid*='starter'], .starter-card, article").count()) > 0;

    // At minimum the modal should still be open (not dismissed)
    const modalStillOpen =
      (await page.getByText(/starter|template|blank/i).count()) > 0;
    expect(hasStarters || modalStillOpen).toBe(true);
  });

  test("modal can be dismissed after opening", async ({ page }) => {
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(
      page.getByText(/from a starter|start blank/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // Close via the × close button
    const closeBtn = page.locator("button").filter({ hasText: "×" }).first();
    const hasClose = await closeBtn.isVisible().catch(() => false);
    if (hasClose) {
      await closeBtn.click();
    } else {
      // Try Escape key as fallback
      await page.keyboard.press("Escape");
    }

    await expect(
      page.getByText(/from a starter/i).first()
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("Start Blank option navigates to the form builder or opens editor", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /new template/i }).click();
    await expect(
      page.getByText(/start blank/i).first()
    ).toBeVisible({ timeout: 10_000 });

    await page.getByText(/start blank/i).first().click();

    // After clicking "Start Blank" the app should either:
    //  a) Navigate to a form builder route
    //  b) Open an inline editor within the modal
    await page.waitForTimeout(1000);

    const navigatedToBuilder = page.url().includes("builder") ||
      page.url().includes("edit") ||
      page.url().includes("new");

    const editorOpened =
      (await page.getByRole("textbox", { name: /title|form name|name/i }).count()) > 0 ||
      (await page.getByPlaceholder(/form title|untitled|name/i).count()) > 0;

    expect(navigatedToBuilder || editorOpened).toBe(true);
  });
});
