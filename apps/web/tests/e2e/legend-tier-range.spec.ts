/**
 * Verifies that the map legend's min/max range is genuinely tier-dependent:
 *   - county tier  → range spans ALL loaded counties  (all 58 CA counties)
 *   - zip tier     → range spans only the SELECTED county's ZIPs, and
 *                    RECOMPUTES when the county changes
 *
 * Expected values derived from raw_acs_demographics in HFA_DEV:
 *   County Population: Alpine County 1,616 → Los Angeles County 9,808,667
 *   Fresno  ZIP Population: 93634 (31) → 93722 (86,110)
 *   Sacramento ZIP Population: 95680 (11) → 95823 (83,607)
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:3000";

async function waitForLegendRange(
  page: Page,
  expectedMin: string,
  expectedMax: string,
  timeout = 20_000,
) {
  await page.waitForFunction(
    ([min, max]) => {
      const minEl = document.querySelector("[data-testid='legend-min']");
      const maxEl = document.querySelector("[data-testid='legend-max']");
      return minEl?.textContent?.trim() === min && maxEl?.textContent?.trim() === max;
    },
    [expectedMin, expectedMax],
    { timeout },
  );
}

async function selectPopulationMetric(page: Page) {
  // Expand Demographic section (second collapsible in sidebar)
  const demoSection = page.locator("button", { hasText: "Demographic" }).first();
  const isExpanded = await demoSection.getAttribute("aria-expanded");
  if (isExpanded !== "true") {
    await demoSection.click();
  }
  // Click the Population radio button
  await page.locator('label:has-text("Population") input[type="radio"]').first().click();
}

test.describe("Legend range is tier-dependent", () => {
  test("county tier: Population spans all 58 CA counties (Alpine → LA County)", async ({
    page,
  }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // Default tier is County — wait for county boundaries to load
    await page.waitForFunction(
      () => (window as Record<string, unknown>).__hfaCountyBoundariesLoaded,
      { timeout: 30_000 },
    );

    await selectPopulationMetric(page);

    // County tier must span all 58 CA counties
    // Alpine County (min) = 1,616; LA County (max) = 9,808,667
    await waitForLegendRange(page, "1,616", "9,808,667");

    const minText = await page
      .locator("[data-testid='legend-min']")
      .textContent();
    const maxText = await page
      .locator("[data-testid='legend-max']")
      .textContent();

    expect(minText?.trim()).toBe("1,616");   // Alpine County
    expect(maxText?.trim()).toBe("9,808,667"); // Los Angeles County
  });

  test("zip tier (Fresno County): Population spans only Fresno ZIPs", async ({
    page,
  }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => (window as Record<string, unknown>).__hfaCountyBoundariesLoaded,
      { timeout: 30_000 },
    );

    await selectPopulationMetric(page);

    // Switch to ZIP tier
    await page.locator("button", { hasText: "Zip" }).click();
    await page.waitForFunction(
      () => (window as Record<string, unknown>).__hfaBoundariesLoaded,
      { timeout: 30_000 },
    );

    // Fresno County ZIP Population: 93634 (31) → 93722 (86,110)
    await waitForLegendRange(page, "31", "86,110");

    const minText = await page
      .locator("[data-testid='legend-min']")
      .textContent();
    const maxText = await page
      .locator("[data-testid='legend-max']")
      .textContent();

    expect(minText?.trim()).toBe("31");
    expect(maxText?.trim()).toBe("86,110");
  });

  test("zip tier: range recomputes when county changes (Fresno → Sacramento)", async ({
    page,
  }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.waitForFunction(
      () => (window as Record<string, unknown>).__hfaCountyBoundariesLoaded,
      { timeout: 30_000 },
    );

    await selectPopulationMetric(page);

    // Start at ZIP tier in Fresno County (default)
    await page.locator("button", { hasText: "Zip" }).click();
    await page.waitForFunction(
      () => (window as Record<string, unknown>).__hfaBoundariesLoaded,
      { timeout: 30_000 },
    );
    // Confirm Fresno range
    await waitForLegendRange(page, "31", "86,110", 15_000);

    // Search for Sacramento County via geographic search bar
    const searchInput = page
      .locator('input[placeholder*="Search"]')
      .first();
    await searchInput.fill("Sacramento County");
    const result = page
      .locator('[role="option"]:has-text("Sacramento"), li:has-text("Sacramento")')
      .first();
    await result.waitFor({ state: "visible", timeout: 8_000 });
    await result.click();

    // Selecting a county result switches tier to county — switch back to ZIP
    await page.locator("button", { hasText: "Zip" }).click();

    // Wait for Sacramento ZIP boundaries + demographics to load
    // Sacramento ZIP range: min "11" (95680), max "83,607" (95823)
    await waitForLegendRange(page, "11", "83,607", 30_000);

    const minText = await page
      .locator("[data-testid='legend-min']")
      .textContent();
    const maxText = await page
      .locator("[data-testid='legend-max']")
      .textContent();

    expect(minText?.trim()).toBe("11");
    expect(maxText?.trim()).toBe("83,607");
  });
});
