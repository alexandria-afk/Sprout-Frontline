import { test, expect } from "@playwright/test";

test.describe("Training & Maintenance Guides (Admin)", () => {
  test("training page loads", async ({ page }) => {
    await page.goto("/dashboard/training");
    await expect(page).toHaveURL(/training/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("training page heading is visible", async ({ page }) => {
    await page.goto("/dashboard/training");
    await expect(
      page.getByRole("heading", { name: /training/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("training page shows key sections", async ({ page }) => {
    await page.goto("/dashboard/training");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Training modules/courses section should be present
    const hasContent =
      (await page.getByRole("article").count()) > 0 ||
      (await page.locator("[data-testid*='training']").count()) > 0 ||
      (await page.getByText(/course|module|training|material/i).count()) > 0 ||
      (await page.getByText(/no training|empty/i).count()) > 0;
    expect(hasContent).toBe(true);
  });

  test("maintenance guides page loads", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page).toHaveURL(/maintenance.*guides|guides/);
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
  });

  test("maintenance guides page heading is visible", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    // Use .first() to avoid strict mode violation when multiple headings match /guide/i
    await expect(
      page.getByRole("heading", { name: /guide/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Generate with Sidekick is visible on guides page", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/sidekick/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("guides list or empty state renders", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    const hasContent =
      (await page.getByRole("article").count()) > 0 ||
      (await page.locator("[data-testid*='guide']").count()) > 0 ||
      (await page.getByText(/no guides|no results|empty/i).count()) > 0 ||
      (await page.getByText(/guide/i).count()) > 1;
    expect(hasContent).toBe(true);
  });

  test("Upload Guide button is visible on guides page", async ({ page }) => {
    await page.goto("/dashboard/maintenance/guides");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /upload guide/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("training page loads content", async ({ page }) => {
    await page.goto("/dashboard/training");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15_000,
    });
    // Training page should have some content after load
    const hasContent =
      (await page.getByRole("heading").count()) > 0 ||
      (await page.getByText(/course|module|training|learning/i).count()) > 0;
    expect(hasContent).toBe(true);
  });
});
