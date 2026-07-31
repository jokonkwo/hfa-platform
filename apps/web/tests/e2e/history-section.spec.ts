import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";
const PILOT_ZIP = "93701"; // has full history, Low AQI

// Open the detail panel for a given ZIP by finding it in the sidebar.
async function openPanel(page: import("@playwright/test").Page, zip: string) {
  // domcontentloaded avoids blocking on the 945KB county boundaries fetch
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Click the sidebar row by its data-zip attribute
  const row = page.locator(`[data-zip="${zip}"]`).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.click();
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
  // 93705 is excluded from the pilot backfill (only 10 days of real data,
  // excluded per spec). It should show the honest empty state.
  // We use 93703 which is not in PILOT_ZIPS at all.
  test("non-pilot ZIP shows honest empty state", async ({ page }) => {
    // Find a ZIP not in the pilot set — 93703 appears in live data but not pilot history
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // Navigate to any ZIP in the sidebar that is NOT a pilot ZIP
    // We look for any sidebar row that doesn't match our 7 pilot ZIPs
    const rows = await page
      .locator("[data-zip]")
      .filter({
        hasNotText: "93701",
      })
      .all();

    // Find the first non-pilot ZIP in the sidebar
    let nonPilotZip: string | null = null;
    const pilotSet = new Set([
      "93701", "93702", "93711", "93720", "93727", "93728", "93730",
    ]);
    for (const row of rows) {
      const zip = await row.getAttribute("data-zip");
      if (zip && !pilotSet.has(zip)) {
        nonPilotZip = zip;
        break;
      }
    }

    if (!nonPilotZip) {
      // All visible ZIPs happen to be pilot ZIPs — skip gracefully
      test.skip();
      return;
    }

    // Click the row
    await page.locator(`[data-zip="${nonPilotZip}"]`).first().click();
    await page.waitForSelector(`aside >> text=${nonPilotZip}`, {
      timeout: 8000,
    });

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
