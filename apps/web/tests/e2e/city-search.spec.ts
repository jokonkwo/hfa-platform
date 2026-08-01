/**
 * City / place search tests.
 *
 * Verifies that searching for a city name returns place results (type="place")
 * labeled "City" in the dropdown, and that selecting a city navigates to ZIP
 * tier and loads that county's ZIP boundaries.
 */
import { test, expect, type Page } from "@playwright/test";

type W = Window & typeof globalThis;

async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaMapLoaded?: boolean }).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

test.describe("City search", () => {
  test("typing a city name shows place results with City badge", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    const input = page.getByRole("textbox", { name: /search states/i });
    await input.fill("Chicago");
    // Wait for debounce (300ms) + API round-trip to MotherDuck
    await page.waitForTimeout(600);

    // At least one result with "Chicago" in text.
    const dropdown = page.locator("ul[role='listbox']");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    // Should have a "City" badge item for Chicago, IL.
    const chicagoBadge = page.locator("ul[role='listbox'] button").filter({
      has: page.locator("span", { hasText: "City" }),
    }).filter({ hasText: "Chicago" }).first();
    await expect(chicagoBadge).toBeVisible({ timeout: 5_000 });
    console.log("Chicago city result visible with 'City' badge ✓");
  });

  test("selecting a city switches to ZIP tier and loads county ZIPs", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    const input = page.getByRole("textbox", { name: /search states/i });
    await input.fill("Fresno");
    await page.waitForTimeout(400);

    const dropdown = page.locator("ul[role='listbox']");
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    // Click "Fresno, CA" city result (not the county).
    const fresnoCityBtn = page.locator("ul[role='listbox'] button").filter({
      has: page.locator("span", { hasText: "City" }),
    }).filter({ hasText: "Fresno, CA" }).first();
    await expect(fresnoCityBtn).toBeVisible({ timeout: 5_000 });
    console.log("Fresno, CA city result visible ✓");

    await fresnoCityBtn.click({ force: true });
    await page.waitForTimeout(200);

    // Tier should have switched to "zip".
    await page.waitForFunction(
      () => (window as W & { __hfaTier?: string }).__hfaTier === "zip",
      { timeout: 5_000, polling: 200 },
    );
    console.log("Tier switched to zip ✓");

    // ZIP boundaries for Fresno County should load.
    await page.waitForFunction(
      () => (window as W & { __hfaBoundariesLoaded?: boolean }).__hfaBoundariesLoaded === true,
      { timeout: 20_000, polling: 300 },
    );
    console.log("ZIP boundaries loaded ✓");
  });

  test("Atlanta search returns Atlanta GA city result", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    const input = page.getByRole("textbox", { name: /search states/i });
    await input.fill("Atlanta");
    // Wait for debounce (300ms) + MotherDuck round-trip (potentially cold)
    await page.waitForTimeout(600);

    const dropdown = page.locator("ul[role='listbox']");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    // Should contain at least one city result for Atlanta.
    const cityResults = page.locator("ul[role='listbox'] button").filter({
      has: page.locator("span", { hasText: "City" }),
    }).filter({ hasText: "Atlanta" });
    const count = await cityResults.count();
    expect(count).toBeGreaterThanOrEqual(1);
    console.log(`Atlanta city results: ${count} ✓`);
  });
});
