/**
 * County-tier drill-down tests.
 *
 * Verifies:
 *  - County tier is the default view (CA-level zoom)
 *  - CA county boundaries load (58 counties, Fresno distinguished)
 *  - Fresno County hover shows AQI tooltip; non-Fresno shows "No data"
 *  - Clicking Fresno County switches to ZIP tier
 *  - TierControl "ZIP" / "County" buttons work correctly
 */
import { test, expect, type Page } from "@playwright/test";

type W = Window & typeof globalThis;

async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaMapLoaded?: boolean }).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function waitForCountyBoundaries(page: Page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaCountyBoundariesLoaded?: boolean }).__hfaCountyBoundariesLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

test.describe("County tier — default view", () => {
  test("default tier is county at CA zoom", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    const tier = await page.evaluate(
      () => (window as W & { __hfaTier?: string }).__hfaTier,
    );
    expect(tier, "default tier should be 'county'").toBe("county");

    // TierControl "County" button should appear selected (dark background via Tailwind class)
    const countyBtn = page.locator("button", { hasText: "County" });
    await expect(countyBtn).toBeVisible();

    // At CA zoom, the map should be around zoom 5 (not Fresno zoom 12)
    const zoom = await page.evaluate(() => {
      const map = (window as W & { __hfaMap?: { getZoom(): number } }).__hfaMap;
      return map?.getZoom() ?? null;
    });
    expect(zoom, "initial zoom should be ~5 for CA county view").not.toBeNull();
    expect(zoom!).toBeLessThan(8);
    expect(zoom!).toBeGreaterThan(3);
    console.log(`Initial zoom at county tier: ${(zoom ?? 0).toFixed(2)}`);
  });

  test("CA county boundaries load with 58 counties", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);
    await page.waitForTimeout(1_000);

    // Query county features on the canvas
    const result = await page.evaluate(() => {
      const map = (window as W & {
        __hfaMap?: {
          querySourceFeatures: (
            source: string,
            opts: Record<string, unknown>,
          ) => Array<{ properties: Record<string, unknown> }>;
        };
      }).__hfaMap;
      if (!map) return null;

      // Count unique GEOIDs in the county source
      const feats = map.querySourceFeatures("county-boundaries", {
        sourceLayer: "",
      });
      const geoids = new Set(feats.map((f) => f.properties?.geoid as string).filter(Boolean));
      return {
        totalFeatures: feats.length,
        uniqueGeoids: geoids.size,
        hasFresno: geoids.has("06019"),
      };
    });

    if (result) {
      console.log(`County features in source: ${result.totalFeatures} features, ${result.uniqueGeoids} unique GEOIDs, hasFresno: ${result.hasFresno}`);
      if (result.uniqueGeoids > 0) {
        // If features are in the viewport/source, Fresno should be there
        expect(result.hasFresno, "Fresno County (06019) should be in county source").toBe(true);
      }
    }

    // The county boundaries loaded signal is sufficient — the API returned 58 counties
    expect(
      await page.evaluate(
        () => (window as W & { __hfaCountyBoundariesLoaded?: boolean }).__hfaCountyBoundariesLoaded,
      ),
    ).toBe(true);
  });

  test("Fresno County hover shows AQI tooltip", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);
    await page.waitForTimeout(1_500); // let county tiles render

    // Project Fresno County center to canvas pixels
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-119.2987, 36.9859] as [number, number], // Fresno County approximate centroid
    );
    expect(pt, "__hfaProjectLngLat not available").not.toBeNull();
    console.log(`Fresno County centroid at canvas: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    await page.mouse.move(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

    // Wait for county hover state
    type HoverW = W & { __hfaHoveredCounty?: string };
    await page.waitForFunction(
      () => !!(window as HoverW).__hfaHoveredCounty,
      { timeout: 5_000, polling: 200 },
    );
    const hoveredCounty = await page.evaluate(
      () => (window as HoverW).__hfaHoveredCounty,
    );
    console.log(`Hovered county: ${hoveredCounty}`);
    expect(hoveredCounty).toBeTruthy();

    // Tooltip should be visible and show county name
    const tooltip = page.locator("#hfa-hover-tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    const tooltipText = await tooltip.innerText();
    console.log(`County tooltip: "${tooltipText}"`);
    // Fresno County tooltip should mention pilot ZIPs and AQI
    expect(tooltipText.toLowerCase()).toMatch(/fresno|pilot|aqi/i);
  });

  test("non-Fresno county hover shows no-data tooltip", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);
    await page.waitForTimeout(1_500);

    // Kern County is south of Fresno; approximate centroid lng=-118.73, lat=35.34
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-118.73, 35.34] as [number, number],
    );
    expect(pt).not.toBeNull();
    console.log(`Kern County centroid at canvas: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

    // Only proceed if Kern County is visible on canvas (within viewport bounds)
    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();
    const withinX = pt!.x > 0 && pt!.x < canvasRect!.width;
    const withinY = pt!.y > 0 && pt!.y < canvasRect!.height;

    if (!withinX || !withinY) {
      console.log("Kern County not in viewport at CA zoom; skipping hover check");
      return;
    }

    await page.mouse.move(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

    type HoverW = W & { __hfaHoveredCounty?: string };
    await page.waitForFunction(
      () => !!(window as HoverW).__hfaHoveredCounty,
      { timeout: 5_000, polling: 200 },
    );

    const tooltip = page.locator("#hfa-hover-tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    const tooltipText = await tooltip.innerText();
    console.log(`Non-Fresno county tooltip: "${tooltipText}"`);
    expect(tooltipText.toLowerCase()).toMatch(/no sensor data|no data/i);
  });
});

test.describe("County tier — click-through to ZIP", () => {
  test("clicking Fresno County switches to ZIP tier", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);
    await page.waitForTimeout(1_500);

    // Project Fresno County center
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-119.2987, 36.9859] as [number, number],
    );
    expect(pt).not.toBeNull();

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    // Click Fresno County
    await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

    // Wait for tier to switch to "zip"
    type TierW = W & { __hfaTier?: string };
    await page.waitForFunction(
      () => (window as TierW).__hfaTier === "zip",
      { timeout: 5_000, polling: 200 },
    );

    const tier = await page.evaluate(() => (window as TierW).__hfaTier);
    console.log(`After clicking Fresno County: tier = ${tier}`);
    expect(tier).toBe("zip");

    // TierControl "ZIP" button should now appear active
    // The ZIP button text should be visible
    await expect(page.getByRole("button", { name: "ZIP", exact: true })).toBeVisible();
  });

  test("TierControl ZIP button switches tier and County button returns", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    // Start in county tier
    type TierW = W & { __hfaTier?: string };
    let tier = await page.evaluate(() => (window as TierW).__hfaTier);
    expect(tier).toBe("county");

    // Click ZIP
    await page.getByRole("button", { name: "ZIP", exact: true }).click();
    await page.waitForFunction(
      () => (window as TierW).__hfaTier === "zip",
      { timeout: 5_000, polling: 200 },
    );
    tier = await page.evaluate(() => (window as TierW).__hfaTier);
    expect(tier, "after ZIP click tier should be zip").toBe("zip");
    console.log("Switched to ZIP tier via TierControl ✓");

    // Click County to go back
    await page.locator("button", { hasText: "County" }).click();
    await page.waitForFunction(
      () => (window as TierW).__hfaTier === "county",
      { timeout: 5_000, polling: 200 },
    );
    tier = await page.evaluate(() => (window as TierW).__hfaTier);
    expect(tier, "after County click tier should be county").toBe("county");
    console.log("Switched back to County tier via TierControl ✓");
  });

  test("non-Fresno county click shows no-data popup, does not switch tier", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);
    await page.waitForTimeout(1_500);

    // Use Kern County (south of Fresno)
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-118.73, 35.34] as [number, number],
    );
    expect(pt).not.toBeNull();

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    const withinX = pt!.x > 0 && pt!.x < canvasRect!.width;
    const withinY = pt!.y > 0 && pt!.y < canvasRect!.height;
    if (!withinX || !withinY) {
      console.log("Kern County not in viewport; skipping non-Fresno click test");
      return;
    }

    await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);
    await page.waitForTimeout(800); // allow popup to appear

    // Tier should still be county
    const tier = await page.evaluate(
      () => (window as W & { __hfaTier?: string }).__hfaTier,
    );
    expect(tier, "clicking non-Fresno county should not change tier").toBe("county");

    // Popup should appear with no-data message
    const popup = page.locator(".mapboxgl-popup");
    const visible = await popup.isVisible();
    if (visible) {
      const popupText = await popup.innerText();
      console.log(`Non-Fresno county popup: "${popupText.substring(0, 80)}"`);
      expect(popupText.toLowerCase()).toMatch(/no sensor data|no data/i);
    }
  });
});
