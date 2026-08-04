/**
 * Region-selection regression tests.
 *
 * Verifies:
 *  - Clicking a state in state tier zooms to that state (no popup appears)
 *  - Clicking a county in county tier zooms to that county (no popup appears)
 *  - RegionPanel / DemographicsPanel popup is NOT shown on click (removed in UI v2)
 *
 * Covers Nevada, Arizona, Oregon (state tier) and Sacramento, Merced, LA (county tier).
 */
import { test, expect, type Page } from "@playwright/test";

type W = Window & typeof globalThis;

async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaMapLoaded?: boolean }).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function waitForStateBoundaries(page: Page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaStateBoundariesLoaded?: boolean }).__hfaStateBoundariesLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function waitForCountyBoundaries(page: Page, timeoutMs = 20_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaCountyBoundariesLoaded?: boolean }).__hfaCountyBoundariesLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function switchToStateTier(page: Page) {
  await page.getByRole("button", { name: "State", exact: true }).click();
  await page.waitForFunction(
    () => (window as W & { __hfaTier?: string }).__hfaTier === "state",
    { timeout: 5_000, polling: 200 },
  );
}

type MapType = {
  getCenter: () => { lng: number; lat: number };
  queryRenderedFeatures: (
    pt: [number, number],
    opts: Record<string, unknown>,
  ) => Array<{ properties?: Record<string, unknown> }>;
};

function getMapCenter(page: Page) {
  return page.evaluate(() => {
    const map = (window as W & { __hfaMap?: MapType }).__hfaMap;
    if (!map) return null;
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat };
  });
}

function projectLngLat(page: Page, lng: number, lat: number) {
  type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
  return page.evaluate(
    ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
    [lng, lat] as [number, number],
  );
}

// Wait until a specific layer has a rendered feature at canvas coords [cx, cy].
async function waitForFeatureAt(
  page: Page,
  cx: number,
  cy: number,
  layer: string,
  propKey: string,
  propValue: string,
) {
  await page.waitForFunction(
    ({ x, y, layer, key, val }: { x: number; y: number; layer: string; key: string; val: string }) => {
      const map = (window as unknown as Record<string, unknown>).__hfaMap as MapType | undefined;
      if (!map) return false;
      try {
        const feats = map.queryRenderedFeatures([x, y], { layers: [layer] });
        return feats.some((f) => String(f.properties?.[key]) === val);
      } catch { return false; }
    },
    { x: cx, y: cy, layer, key: propKey, val: propValue },
    { timeout: 12_000, polling: 300 },
  );
}

// ── State tier: clicking non-CA states ──────────────────────────────────────

test.describe("State tier — clicking non-CA states zooms to that state", () => {
  const states = [
    { name: "Nevada",  geoid: "32", centroid: [-116.42, 38.80] as [number, number] },
    { name: "Arizona", geoid: "04", centroid: [-111.09, 34.07] as [number, number] },
    { name: "Oregon",  geoid: "41", centroid: [-120.50, 44.00] as [number, number] },
  ];

  for (const state of states) {
    test(`clicking ${state.name} zooms to that state (no popup)`, async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForMapLoad(page);
      await switchToStateTier(page);
      await waitForStateBoundaries(page);
      await page.waitForTimeout(1_200); // let state tiles rasterise

      const initialCenter = await getMapCenter(page);
      expect(initialCenter, "map center not available").not.toBeNull();

      const pt = await projectLngLat(page, state.centroid[0], state.centroid[1]);
      expect(pt, `${state.name} centroid projection unavailable`).not.toBeNull();
      console.log(`${state.name} centroid at canvas: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

      const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
      expect(canvasRect).not.toBeNull();

      const withinX = pt!.x > 10 && pt!.x < canvasRect!.width - 10;
      const withinY = pt!.y > 10 && pt!.y < canvasRect!.height - 10;
      if (!withinX || !withinY) {
        console.log(`${state.name} centroid not in viewport; skipping`);
        return;
      }

      const { cx, cy } = { cx: Math.round(pt!.x), cy: Math.round(pt!.y) };
      await waitForFeatureAt(page, cx, cy, "state-boundary-fill", "geoid", state.geoid);
      console.log(`${state.name} polygon confirmed rendered at click position ✓`);

      // Record center before click
      const centerBefore = await getMapCenter(page);

      await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

      // NO popup should appear — RegionPanel was removed in UI v2
      await page.waitForTimeout(600);
      await expect(page.locator("[data-region-panel]")).not.toBeVisible();

      // Tier must stay "state"
      const tier = await page.evaluate(
        () => (window as W & { __hfaTier?: string }).__hfaTier,
      );
      expect(tier, `tier should remain 'state' after clicking ${state.name}`).toBe("state");

      // Camera must have moved: wait for animation then check center changed
      await page.waitForTimeout(900); // 600ms animation + buffer
      const centerAfter = await getMapCenter(page);
      expect(centerAfter).not.toBeNull();
      const lngDelta = Math.abs(centerAfter!.lng - centerBefore!.lng);
      const latDelta = Math.abs(centerAfter!.lat - centerBefore!.lat);
      console.log(`Center moved Δlng=${lngDelta.toFixed(2)} Δlat=${latDelta.toFixed(2)}`);
      // Expect meaningful camera movement (at least 1° in any direction).
      expect(lngDelta + latDelta, "camera must move when a state is clicked").toBeGreaterThan(1.0);
    });
  }
});

// ── County tier: clicking non-Fresno CA counties ──────────────────────────

test.describe("County tier — clicking non-Fresno counties zooms to that county", () => {
  const counties = [
    { name: "Sacramento County", geoid: "06067", centroid: [-121.35, 38.45] as [number, number] },
    { name: "Merced County",     geoid: "06047", centroid: [-120.50, 37.19] as [number, number] },
    { name: "Los Angeles County",geoid: "06037", centroid: [-118.24, 34.17] as [number, number] },
  ];

  for (const county of counties) {
    test(`clicking ${county.name} zooms to it (no popup)`, async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await waitForMapLoad(page);
      await waitForCountyBoundaries(page);
      await page.waitForTimeout(1_200); // let county tiles rasterise

      const pt = await projectLngLat(page, county.centroid[0], county.centroid[1]);
      expect(pt, `${county.name} centroid projection unavailable`).not.toBeNull();
      console.log(`${county.name} centroid at canvas: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

      const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
      expect(canvasRect).not.toBeNull();

      const withinX = pt!.x > 10 && pt!.x < canvasRect!.width - 10;
      const withinY = pt!.y > 10 && pt!.y < canvasRect!.height - 10;
      if (!withinX || !withinY) {
        console.log(`${county.name} centroid not in viewport; skipping`);
        return;
      }

      const { cx, cy } = { cx: Math.round(pt!.x), cy: Math.round(pt!.y) };
      await waitForFeatureAt(page, cx, cy, "county-boundary-fill", "geoid", county.geoid);
      console.log(`${county.name} polygon confirmed rendered at click position ✓`);

      const centerBefore = await getMapCenter(page);

      await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

      // NO popup should appear — RegionPanel was removed in UI v2
      await page.waitForTimeout(600);
      await expect(page.locator("[data-region-panel]")).not.toBeVisible();

      // Tier must stay "county"
      const tier = await page.evaluate(
        () => (window as W & { __hfaTier?: string }).__hfaTier,
      );
      expect(tier, `tier should remain 'county' after clicking ${county.name}`).toBe("county");

      // Camera must have moved
      await page.waitForTimeout(900);
      const centerAfter = await getMapCenter(page);
      expect(centerAfter).not.toBeNull();
      const lngDelta = Math.abs(centerAfter!.lng - centerBefore!.lng);
      const latDelta = Math.abs(centerAfter!.lat - centerBefore!.lat);
      console.log(`Center moved Δlng=${lngDelta.toFixed(2)} Δlat=${latDelta.toFixed(2)}`);
      expect(lngDelta + latDelta, "camera must move when a county is clicked").toBeGreaterThan(0.5);
    });
  }
});
