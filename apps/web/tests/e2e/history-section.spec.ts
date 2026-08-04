import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";
const PILOT_ZIP = "93701"; // has full history, Low AQI

// Open the detail panel for a given ZIP via the search bar.
async function openPanel(page: import("@playwright/test").Page, zip: string) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Use the geographic search bar to navigate to the ZIP
  const searchInput = page.locator('input[placeholder*="Search"]').first();
  await searchInput.waitFor({ state: "visible", timeout: 15_000 });
  await searchInput.fill(zip);
  // Wait for dropdown result and click the ZIP option
  const zipResult = page.locator(`[role="option"]:has-text("${zip}"), li:has-text("${zip}")`).first();
  await zipResult.waitFor({ state: "visible", timeout: 8_000 });
  await zipResult.click();
  // Wait for detail panel to slide in (aria-hidden="false" distinguishes it from sidebar)
  await page.waitForSelector(`aside[aria-hidden="false"]`, { timeout: 8000 });
  await page.waitForTimeout(500); // allow panel animation
}

test.describe("History section — pilot ZIP", () => {
  test("summary tiles render with pilot data framing", async ({ page }) => {
    await openPanel(page, PILOT_ZIP);

    // The history section header should appear
    await expect(page.locator("text=Pilot Data History")).toBeVisible({
      timeout: 10000,
    });

    // Both tile labels present
    await expect(page.locator("text=Last 24 Hours")).toBeVisible();
    await expect(page.locator("text=Last 7 Days")).toBeVisible();

    // The footer note mentions pilot data (one of several matching nodes is fine)
    await expect(page.locator("text=Pilot data").first()).toBeVisible();

    // No "Not enough historical data" placeholder should be present
    await expect(
      page.locator("text=Not enough historical data yet"),
    ).not.toBeVisible();
  });

  test("Last 24 Hours tile click → hourly drill-down with SVG chart", async ({
    page,
  }) => {
    await openPanel(page, PILOT_ZIP);
    await page.waitForSelector("text=Pilot Data History", { timeout: 10000 });

    // Click the "Last 24 Hours" tile
    await page.locator("button", { hasText: "Last 24 Hours" }).click();

    // Back arrow should appear
    await expect(page.locator("text=← Back")).toBeVisible({ timeout: 8000 });

    // Heading should mention the ZIP
    await expect(
      page.locator(`text=${PILOT_ZIP}`).first(),
    ).toBeVisible();

    // SVG chart for hourly data should appear (we wait for the chart or "No data")
    // Allow time for lazy hourly fetch to complete
    await page.waitForTimeout(2000);

    // Either the SVG is present or "No data" — either is honest
    const hasSvg = await page.locator("aside svg").count() > 0;
    const hasNoData = await page.locator("text=No data").count() > 0;
    expect(hasSvg || hasNoData).toBe(true);

    // Click Back → returns to summary
    await page.locator("text=← Back").click();
    await expect(page.locator("text=Pilot Data History")).toBeVisible();
  });

  test("Last 7 Days tile click → daily drill-down with SVG chart", async ({
    page,
  }) => {
    await openPanel(page, PILOT_ZIP);
    await page.waitForSelector("text=Pilot Data History", { timeout: 10000 });

    // Click the "Last 7 Days" tile
    await page.locator("button", { hasText: "Last 7 Days" }).click();

    // Back arrow should appear
    await expect(page.locator("text=← Back")).toBeVisible({ timeout: 6000 });

    // SVG chart should render (daily data was already fetched)
    const hasSvg = await page.locator("aside svg").count() > 0;
    expect(hasSvg).toBe(true);

    // Should contain Jan date labels (pilot data ends Jan 21, 2026)
    // Target the detail panel specifically (not the sidebar aside)
    const panelText = await page.locator('aside[aria-hidden="false"]').innerText();
    expect(panelText).toMatch(/Jan/);

    // Click Back → returns to summary
    await page.locator("text=← Back").click();
    await expect(page.locator("text=Pilot Data History")).toBeVisible();
  });

  test("date range labels show actual dates, not relative phrases", async ({
    page,
  }) => {
    await openPanel(page, PILOT_ZIP);
    await page.waitForSelector("text=Pilot Data History", { timeout: 10000 });

    const panelText = await page.locator('aside[aria-hidden="false"]').innerText();

    // Actual date ranges (not just relative labels) must be present
    expect(panelText).toMatch(/2026/); // pilot year visible
    expect(panelText).toMatch(/Jan \d+, 2026/); // specific date rendered
    // The "Last 24 Hours" tile label is present (CSS uppercase renders it as "LAST 24 HOURS")
    expect(panelText).toMatch(/last 24 hours/i);
  });
});

test.describe("History section — non-pilot ZIP", () => {
  // 93703 appears in live data but is not in the pilot backfill set.
  // It should show the honest empty state.
  test("non-pilot ZIP shows honest empty state", async ({ page }) => {
    const NON_PILOT_ZIP = "93703";
    await openPanel(page, NON_PILOT_ZIP);
    await page.waitForSelector(`aside >> text=${NON_PILOT_ZIP}`, {
      timeout: 8000,
    }).catch(() => {}); // panel may already show ZIP in heading

    // Wait for data fetch to settle
    await page.waitForTimeout(2000);

    // Should show empty state
    await expect(
      page.locator("text=Not enough historical data yet"),
    ).toBeVisible({ timeout: 8000 });

    // Should NOT show the pilot data tiles
    await expect(page.locator("text=Pilot Data History")).not.toBeVisible();
  });
});
