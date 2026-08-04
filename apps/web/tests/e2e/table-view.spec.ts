import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3000";

test.describe("TableViewModal — tier-aware columns", () => {
  test("county tier: RK | County | PM2.5 AQI | Population (AQI metric)", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector('[data-testid="boundary-loading"]', { state: "hidden", timeout: 15000 }).catch(() => {});
    await page.locator('button:has-text("Table")').click();
    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    const headers = table.locator("thead th");
    await expect(headers.nth(0)).toContainText("RK");
    await expect(headers.nth(1)).toContainText("County");
    await expect(headers.nth(2)).toContainText("PM2.5 AQI");
    await expect(headers.nth(3)).toContainText("Population");
    await expect(headers).toHaveCount(4);
  });

  test("county tier: Median HH Income → RK | County | Median HH Income | Poverty Rate | Population", async ({ page }) => {
    await page.goto(BASE);
    // Expand demographics and pick Median Household Income
    await page.locator("text=Demographic").click();
    await page.locator("text=Median Household Income").click();
    await page.locator('button:has-text("Table")').click();

    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    const headers = table.locator("thead th");
    await expect(headers.nth(1)).toContainText("County");
    await expect(headers.nth(2)).toContainText("Median Household Income");
    await expect(headers.nth(3)).toContainText("Poverty Rate");
    await expect(headers.nth(4)).toContainText("Population");
    await expect(headers).toHaveCount(5);
  });

  test("ZIP tier: RK | ZIP | City | PM2.5 AQI | Population (AQI metric)", async ({ page }) => {
    await page.goto(BASE);
    await page.locator('label:has-text("Zip"), button:has-text("Zip")').first().click();
    // Wait for city data to load (cold spatial query can be slow)
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("Table")').click();

    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    const headers = table.locator("thead th");
    await expect(headers.nth(0)).toContainText("RK");
    await expect(headers.nth(1)).toContainText("ZIP");
    await expect(headers.nth(2)).toContainText("City");
    await expect(headers.nth(3)).toContainText("PM2.5 AQI");
    await expect(headers.nth(4)).toContainText("Population");
    await expect(headers).toHaveCount(5);
  });

  test("ZIP tier: Population metric → no trailing Population column", async ({ page }) => {
    await page.goto(BASE);
    await page.locator('label:has-text("Zip"), button:has-text("Zip")').first().click();
    await page.locator("text=Demographic").click();
    await page.locator("text=Population").first().click();
    await page.locator('button:has-text("Table")').click();

    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    const headers = table.locator("thead th");
    await expect(headers.nth(2)).toContainText("City");
    await expect(headers.nth(3)).toContainText("Population");
    // Secondary is Median HH Income, no trailing Population (already selected)
    await expect(headers.nth(4)).toContainText("Median Household Income");
    // No 6th column
    await expect(headers).toHaveCount(5);
  });
});

test.describe("TableViewModal — sorting", () => {
  test("default sort is desc by selected metric; clicking header toggles asc", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("text=Demographic").click();
    await page.locator("text=Median Household Income").click();
    await page.locator('button:has-text("Table")').click();

    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    // Default: sorted desc by Median HH Income → first value > last visible value
    const cells = table.locator("tbody tr td:nth-child(3)");
    const firstText = await cells.first().textContent();
    const count = await cells.count();
    const lastText = await cells.nth(count - 1).textContent();
    const parse = (t: string | null) =>
      parseFloat((t ?? "0").replace(/[$,%]/g, ""));
    expect(parse(firstText)).toBeGreaterThanOrEqual(parse(lastText));

    // Click header to switch to asc
    await table.locator("thead th:nth-child(3)").click();
    const firstAfter = await cells.first().textContent();
    const lastAfter = await cells.nth(count - 1).textContent();
    expect(parse(firstAfter)).toBeLessThanOrEqual(parse(lastAfter));
  });
});

test.describe("TableViewModal — viewport filter", () => {
  test("county tier subtitle shows a row count", async ({ page }) => {
    await page.goto(BASE);
    // Wait for county boundaries to load
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("Table")').click();

    // Either "Showing N Counties" or "Showing N of 58 counties (map viewport)"
    const subtitle = page.locator("text=/Showing \\d+/");
    await expect(subtitle).toBeVisible({ timeout: 8000 });
  });

  test("county tier viewport filters: county count is between 1 and 58", async ({ page }) => {
    await page.goto(BASE);
    // Wait for county demographics API response before opening table
    await page.waitForResponse(
      (r) => r.url().includes("/v1/demographics/counties") && r.status() === 200,
      { timeout: 15000 }
    );
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Table")').click();

    const subtitle = page.locator('[data-testid="table-subtitle"]');
    // Wait for the subtitle to show a non-zero count
    await expect(subtitle).not.toHaveText("Showing 0 Counties", { timeout: 8000 });
    const text = await subtitle.textContent();
    const match = text?.match(/Showing (\d+)/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(58);
  });
});

test.describe("TableViewModal — ZIP city column", () => {
  test("ZIP rows show city names from /v1/zips/cities", async ({ page }) => {
    // Register response listener BEFORE page load so we don't miss it
    const citiesReady = page.waitForResponse(
      (r) => r.url().includes("/v1/zips/cities") && r.status() === 200,
      { timeout: 35000 }
    );
    await page.goto(BASE);
    await page.locator('label:has-text("Zip"), button:has-text("Zip")').first().click();
    // Await the cities response (cold spatial query can take 20s on first call)
    await citiesReady;
    // Give React a tick to set state
    await page.waitForTimeout(300);
    await page.locator('button:has-text("Table")').click();

    const table = page.locator('[data-testid="table-view"]');
    await expect(table).toBeVisible({ timeout: 5000 });

    // At least one row should have a non-dash city value
    const cityCells = table.locator("tbody tr td:nth-child(3)");
    const texts = await cityCells.allTextContents();
    const hasCity = texts.some((t) => t.trim() !== "—" && t.trim() !== "");
    expect(hasCity).toBe(true);
  });
});
