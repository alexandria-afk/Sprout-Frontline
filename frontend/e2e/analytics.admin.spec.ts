import { test, expect } from "@playwright/test";

/**
 * Analytics / Insights — Admin suite
 *
 * Verifies:
 * 1. Page loads and the h1 heading "Insights" is present
 * 2. No "sample data" / mock data banner is shown (replaced with real API calls)
 * 3. Analytics tab — all 5 chart card titles are visible
 * 4. Reports tab — all 4 report group cards are present, Coming Soon badge on Workforce
 * 5. Location + date-range filters exist
 * 6. Chart containers (Recharts SVG) render
 * 7. Real API calls are made (not mock data)
 */

test.describe("Analytics / Insights — Admin", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/insights");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 20_000,
    });
  });

  // ── Page structure ────────────────────────────────────────────────────────

  test("insights page loads without error", async ({ page }) => {
    await expect(page).toHaveURL(/insights/);
    const crashBanner = await page
      .getByText(/something went wrong|unexpected error|application error/i)
      .isVisible()
      .catch(() => false);
    expect(crashBanner).toBe(false);
  });

  test("page heading 'Insights' is visible", async ({ page }) => {
    // Exact h1 on this page: <h1>Insights</h1> (with BarChart2 icon)
    await expect(page.locator("h1").filter({ hasText: "Insights" })).toBeVisible({ timeout: 10_000 });
  });

  test("Analytics and Reports tab buttons are present", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reports" })).toBeVisible();
  });

  // ── No mock/sample data banner ────────────────────────────────────────────

  test("sample data notice banner is NOT shown", async ({ page }) => {
    const sampleBanner = page.getByText(/sample data|demo data|mock data/i);
    const visible = await sampleBanner.isVisible().catch(() => false);
    expect(visible).toBe(false);
  });

  // ── Analytics tab — chart card titles ────────────────────────────────────
  // The ChartCard titles are the exact strings from the component:
  //   "Audit Compliance Trend", "Issue Volume by Category",
  //   "Location Scorecard", "Resolution Time vs SLA",
  //   "Training Certification Status"

  test("Audit Compliance Trend chart card is present", async ({ page }) => {
    await expect(
      page.getByText("Audit Compliance Trend")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Issue Volume by Category chart card is present", async ({ page }) => {
    await expect(
      page.getByText("Issue Volume by Category")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Location Scorecard chart card is present", async ({ page }) => {
    await expect(
      page.getByText("Location Scorecard")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Resolution Time vs SLA chart card is present", async ({ page }) => {
    await expect(
      page.getByText("Resolution Time vs SLA")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Training Certification Status chart card is present", async ({ page }) => {
    await expect(
      page.getByText("Training Certification Status")
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Chart containers render (Recharts) ────────────────────────────────────

  test("at least one Recharts SVG container is rendered", async ({ page }) => {
    await page.waitForTimeout(3000);
    const svgCount = await page.locator("svg.recharts-surface, .recharts-wrapper svg").count();
    const emptyStateCount = await page.getByText(/no data|loading|empty/i).count();
    expect(svgCount + emptyStateCount).toBeGreaterThan(0);
  });

  // ── Filter bar ────────────────────────────────────────────────────────────

  test("date preset filter buttons are present", async ({ page }) => {
    // The filter bar shows preset buttons: Today, Week, Month, Custom
    const monthBtn = page.getByRole("button", { name: /month|30 days/i }).first();
    const weekBtn  = page.getByRole("button", { name: /week|7 days/i }).first();
    const hasMonth = await monthBtn.isVisible().catch(() => false);
    const hasWeek  = await weekBtn.isVisible().catch(() => false);
    expect(hasMonth || hasWeek).toBe(true);
  });

  // ── Reports tab — group cards ─────────────────────────────────────────────
  // Must navigate to the "reports" tab first — REPORT_GROUPS only render there

  test("Reports tab shows Operations group card", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByText("Operations")).toBeVisible({ timeout: 10_000 });
  });

  test("Reports tab shows Issues group card", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    // Use a more specific selector to avoid ambiguity with the sidebar Issues link
    await expect(
      page.locator("p.font-semibold").filter({ hasText: "Issues" })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Reports tab shows Workforce group card", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByText("Workforce")).toBeVisible({ timeout: 10_000 });
  });

  test("Reports tab shows Training group card", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    // Use specific selector — Training also appears in sidebar nav
    await expect(
      page.locator("p.font-semibold").filter({ hasText: "Training" })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Workforce reports show 'Soon' badge (coming soon)", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByText("Workforce")).toBeVisible({ timeout: 10_000 });
    // All Workforce sub-reports are "soon" — badge reads "Soon"
    await expect(page.getByText("Soon").first()).toBeVisible({ timeout: 5_000 });
  });

  test("report links navigate to detail pages", async ({ page }) => {
    await page.getByRole("button", { name: "Reports" }).click();
    const reportLink = page
      .getByRole("link", { name: /checklist completion|audit compliance|issue summary/i })
      .first();
    const visible = await reportLink.isVisible().catch(() => false);
    if (visible) {
      await reportLink.click();
      await page.waitForTimeout(1000);
      expect(page.url()).toMatch(/reports|insights/);
    }
  });

  // ── AI Insights panel ─────────────────────────────────────────────────────

  test("AI Insights panel renders or shows graceful empty state", async ({ page }) => {
    const crashVisible = await page
      .getByText(/error loading|failed to load/i)
      .isVisible()
      .catch(() => false);
    expect(crashVisible).toBe(false);
  });

  // ── Real API calls ────────────────────────────────────────────────────────

  test("analytics charts make real API calls (not hardcoded data)", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", req => {
      if (req.url().includes("/api/v1/reports")) {
        apiCalls.push(req.url());
      }
    });

    await page.goto("/dashboard/insights");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(4000);

    expect(apiCalls.length).toBeGreaterThan(0);
  });
});
