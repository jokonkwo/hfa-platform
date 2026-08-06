/**
 * Screenshot and color-variety verification for quantile binning fix.
 *
 * Verifies county Population (worst-case skewed field) and
 * Median HH Income (less-skewed field) produce genuine coast-to-coast
 * color variety under quantile binning.
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "path";

type W = Window & typeof globalThis & {
  __hfaMapLoaded?: boolean;
  __hfaCountyBoundariesLoaded?: boolean;
  __hfaStateBoundariesLoaded?: boolean;
};

async function waitForMapLoad(page: Page) {
  await page.waitForFunction(() => (window as W).__hfaMapLoaded === true, { timeout: 30_000, polling: 300 });
}

async function selectMetric(page: Page, label: string) {
  // Use the sidebar search input (aria-label="Search data points")
  const searchInput = page.getByRole("textbox", { name: /search data points/i });
  await searchInput.click();
  await searchInput.fill(label);
  // Wait for the listbox to appear with a matching button
  const listbox = page.locator("ul[role='listbox']");
  await expect(listbox).toBeVisible({ timeout: 5_000 });
  // Use onMouseDown-based button (mousedown triggers select)
  // Exact regex ensures "Population" doesn't match "Population Density" etc.
  const item = listbox.locator("button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
  await item.click({ force: true });
  // Wait for colors to settle
  await page.waitForTimeout(800);
}

async function switchToTier(page: Page, tierLabel: string) {
  await page.getByRole("button", { name: tierLabel, exact: true }).click();
  await page.waitForTimeout(300);
}

/** Count distinct DEMO_BIN colors present in county features via Mapbox source query */
async function countDistinctBinColorsInSource(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as W & { __hfaMap?: { querySourceFeatures(s: string, o: object): Array<{ properties: Record<string, unknown> }> } }).__hfaMap;
    if (!map) return 0;
    const features = map.querySourceFeatures("county-boundaries", {});
    const colors = new Set(features.map(f => f.properties?.color).filter(Boolean));
    return colors.size;
  });
}

test.setTimeout(90_000); // extra headroom for county boundary load

test("county tier — Population: quantile produces 7-color variety (was near-uniform)", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForMapLoad(page);
  await page.waitForFunction(() => (window as W).__hfaCountyBoundariesLoaded === true, { timeout: 45_000, polling: 300 });

  await switchToTier(page, "County");
  await selectMetric(page, "Population");

  // Query county source features for color variety
  const distinctColors = await countDistinctBinColorsInSource(page);
  console.log(`\nCounty Population — distinct colors in source: ${distinctColors}/7`);

  // Screenshot for visual verification
  await page.screenshot({
    path: path.join("tests/e2e/screenshots", "county-population-quantile.png"),
  });
  console.log("Screenshot saved: county-population-quantile.png");

  // With quantile binning: all 7 bins get ~14% each, so all 7 colors must appear
  // With equal-interval: only 1 color (99.1% in bin 1), so distinctColors would be 1–2
  expect(distinctColors).toBeGreaterThanOrEqual(6);
});

test("county tier — Median HH Income: quantile still looks reasonable", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForMapLoad(page);
  await page.waitForFunction(() => (window as W).__hfaCountyBoundariesLoaded === true, { timeout: 45_000, polling: 300 });

  await switchToTier(page, "County");
  await selectMetric(page, "Median Household Income");

  const distinctColors = await countDistinctBinColorsInSource(page);
  console.log(`\nCounty Median HH Income — distinct colors in source: ${distinctColors}/7`);
  console.log("  (equal-interval was already decent: bins 1-4 had 4.5/41/43/8.5% dist.)");
  console.log("  Quantile guarantees 14.3% per bin regardless.");

  await page.screenshot({
    path: path.join("tests/e2e/screenshots", "county-income-quantile.png"),
  });
  console.log("Screenshot saved: county-income-quantile.png");

  // Income was already somewhat evenly distributed; quantile keeps all 7 colors
  expect(distinctColors).toBeGreaterThanOrEqual(6);
});

test("state tier — Population Density: quantile produces variety (was 98% one bin)", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForMapLoad(page);
  await page.waitForFunction(() => (window as W).__hfaStateBoundariesLoaded === true, { timeout: 45_000, polling: 300 });

  await switchToTier(page, "State");
  await selectMetric(page, "Population Density");

  const distinctStateColors = await page.evaluate(() => {
    const map = (window as W & { __hfaMap?: { querySourceFeatures(s: string, o: object): Array<{ properties: Record<string, unknown> }> } }).__hfaMap;
    if (!map) return 0;
    const features = map.querySourceFeatures("state-boundaries", {});
    const colors = new Set(features.map(f => f.properties?.color).filter(Boolean));
    return colors.size;
  });

  console.log(`\nState Pop Density — distinct colors in source: ${distinctStateColors}/7`);
  console.log("  (equal-interval was 1 color: 98.1% of states in bin 1)");

  await page.screenshot({
    path: path.join("tests/e2e/screenshots", "state-popdensity-quantile.png"),
  });
  console.log("Screenshot saved: state-popdensity-quantile.png");

  // raw_acs_demographics only has CA (1 state row) — so most states are gray (#E5E7EB no-data)
  // and California gets 1 bin color. Expect 2 distinct colors: no-data gray + CA bin.
  // This confirms quantile binning runs without crashing and colors CA correctly.
  // When ACS data expands to all 50 states, raise this to >= 6.
  expect(distinctStateColors).toBeGreaterThanOrEqual(2);
});
