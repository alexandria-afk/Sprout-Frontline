import { test, expect } from "@playwright/test";

test.describe("Report Pages", () => {
  test("Safety Leaderboard loads with summary cards and table", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/safety/leaderboard");
    await expect(page.getByRole("heading", { name: /leaderboard/i })).toBeVisible();
    // Wait for data or empty state (loading spinner clears first)
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    // Either summary cards render (has Participants label) or empty state renders
    const hasData = await page.getByText("Participants").isVisible().catch(() => false);
    const hasEmpty = await page.getByText(/no leaderboard data|no data available/i).isVisible().catch(() => false);
    expect(hasData || hasEmpty).toBe(true);
  });

  test("Tasks Report loads with filters and stat cards", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/tasks");
    // Heading is "Task Completion Report"
    await expect(page.getByRole("heading", { name: /task/i })).toBeVisible();
    // Wait for loading spinner to clear
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    // Date range filter buttons use full labels
    const filter30 = page.getByRole("button", { name: /last 30/i });
    await expect(filter30).toBeVisible({ timeout: 10_000 });
    // Stat cards
    await expect(page.getByText("Total Tasks")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Completion Rate", { exact: true })).toBeVisible();
    await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
    // Click 60-day filter
    await page.getByRole("button", { name: /last 60/i }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByText("Total Tasks")).toBeVisible();
  });

  test("Tasks Report CSV export button exists", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/tasks");
    await expect(page.getByRole("button", { name: /export|csv/i })).toBeVisible({ timeout: 15_000 });
  });

  test("Issues Summary Report loads with chart area", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/issues/summary");
    // Heading is "Issue Summary Report" (singular)
    await expect(page.getByRole("heading", { name: /issue/i })).toBeVisible();
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("In Progress", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Open", { exact: true })).toBeVisible();
    await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  });

  test("Issues Summary date range filters work", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/issues/summary");
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    // Switch to 60d
    const btn60 = page.getByRole("button", { name: /last 60/i });
    await expect(btn60).toBeVisible({ timeout: 10_000 });
    await btn60.click();
    await page.waitForTimeout(1500);
    await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
    // Switch to 90d
    await page.getByRole("button", { name: /last 90/i }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
  });

  test("CAPs Report loads", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/operations/caps");
    await expect(page.getByRole("heading", { name: /cap/i })).toBeVisible();
    // Wait for loading to complete (spinner disappears)
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    // "Total CAPs" is the stat card label — unique, not present in filter options
    await expect(page.getByText("Total CAPs")).toBeVisible({ timeout: 10_000 });
  });

  test("Checklists Report loads", async ({ page }) => {
    await page.goto("/dashboard/insights/reports/operations/checklists");
    await expect(page.getByRole("heading", { name: /checklist/i })).toBeVisible();
    // Wait for loading to complete
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15_000 });
    // "Completion Rate" is unique to the stat cards section — not in the status filter options
    await expect(page.getByText("Completion Rate")).toBeVisible({ timeout: 10_000 });
  });
});
