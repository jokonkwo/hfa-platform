/**
 * Boundary-loading indicator tests.
 *
 * Verifies that a "Loading boundaries…" badge appears while a county or ZIP
 * boundary fetch is in flight, and disappears once the response lands.
 * Route interception adds a deliberate 1.5s delay so the indicator is
 * reliably visible regardless of API response speed.
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

test.describe("Boundary loading indicator", () => {
  test("county loading badge appears while boundaries fetch and disappears when done", async ({ page }) => {
    // Track delayed boundary request state
    let countyRequestCount = 0;
    let resolveDelay!: () => void;
    const delayed = new Promise<void>(r => { resolveDelay = r; });

    // Intercept county boundary requests; delay the SECOND one (the first is
    // the initial CA load which should be fast from the pre-warmed cache).
    await page.route("**/v1/counties/boundaries*", async (route) => {
      countyRequestCount++;
      if (countyRequestCount >= 2) {
        // Hold the Nevada (or any non-CA) request until we've verified the badge.
        await delayed;
      }
      await route.continue();
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);

    // Loading badge should NOT be visible after initial CA load completes.
    await expect(page.locator("[data-boundary-loading]")).not.toBeVisible({ timeout: 5_000 });
    console.log("Initial CA county load: badge not visible (correct) ✓");

    // Switch to state tier so we can click a state.
    await page.getByRole("button", { name: "State", exact: true }).click();
    await page.waitForFunction(
      () => (window as W & { __hfaTier?: string }).__hfaTier === "state",
      { timeout: 5_000, polling: 200 },
    );
    await page.waitForFunction(
      () => (window as W & { __hfaStateBoundariesLoaded?: boolean }).__hfaStateBoundariesLoaded === true,
      { timeout: 20_000, polling: 300 },
    );
    await page.waitForTimeout(1_000); // let state tiles rasterise

    // Project Nevada's centroid to canvas coordinates.
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-116.42, 38.80] as [number, number],
    );
    expect(pt, "Nevada centroid projection unavailable").not.toBeNull();

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    const withinX = pt!.x > 10 && pt!.x < canvasRect!.width - 10;
    const withinY = pt!.y > 10 && pt!.y < canvasRect!.height - 10;
    if (!withinX || !withinY) {
      console.log("Nevada centroid not in viewport; releasing delay and skipping");
      resolveDelay();
      return;
    }

    // Wait until Nevada's state polygon is rendered at that pixel.
    type MapType = {
      queryRenderedFeatures: (pt: [number, number], opts: Record<string, unknown>) => Array<{ properties?: Record<string, unknown> }>;
    };
    await page.waitForFunction(
      ({ x, y }: { x: number; y: number }) => {
        const map = (window as unknown as Record<string, unknown>).__hfaMap as MapType | undefined;
        if (!map) return false;
        try {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["state-boundary-fill"] });
          return feats.some(f => f.properties?.geoid === "32");
        } catch { return false; }
      },
      { x: Math.round(pt!.x), y: Math.round(pt!.y) },
      { timeout: 10_000, polling: 300 },
    );
    console.log("Nevada polygon confirmed rendered ✓");

    // Click Nevada — triggers a county boundary request for state=32.
    await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

    // The county boundary request for Nevada should be intercepted and delayed.
    // The loading badge must appear while we hold the request.
    await expect(page.locator("[data-boundary-loading]")).toBeVisible({ timeout: 5_000 });
    console.log("Boundary loading badge appeared ✓");

    // Release the delayed response.
    resolveDelay();

    // Badge must disappear once the response lands.
    await expect(page.locator("[data-boundary-loading]")).not.toBeVisible({ timeout: 20_000 });
    console.log("Boundary loading badge disappeared ✓");
  });

  test("ZIP loading badge appears when county changes and disappears after load", async ({ page }) => {
    // Clicking a county in county tier updates selectedCountyGeoid, which triggers
    // a ZIP boundary refetch. Intercept and delay that refetch to reliably observe
    // the loading badge.
    let zipRequestCount = 0;
    let resolveZipDelay!: () => void;
    const zipDelayed = new Promise<void>(r => { resolveZipDelay = r; });

    // Delay the SECOND ZIP boundary request (first is initial Fresno load on mount).
    await page.route("**/v1/zips/boundaries*", async (route) => {
      zipRequestCount++;
      if (zipRequestCount >= 2) {
        await zipDelayed;
      }
      await route.continue();
    });

    // Stay in default county tier (CA zoom 5 — all CA counties visible).
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCountyBoundaries(page);

    // Wait for initial Fresno ZIP load to complete (request 1).
    await page.waitForFunction(
      () => (window as W & { __hfaBoundariesLoaded?: boolean }).__hfaBoundariesLoaded === true,
      { timeout: 20_000, polling: 300 },
    );
    await page.waitForTimeout(600);

    // Badge should be hidden after initial load.
    await expect(page.locator("[data-boundary-loading]")).not.toBeVisible({ timeout: 3_000 });
    console.log("Initial Fresno ZIP load: badge not visible ✓");

    // Project Sacramento County centroid — should be visible at default CA zoom.
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-121.35, 38.45] as [number, number],
    );
    expect(pt, "Sacramento County projection unavailable").not.toBeNull();
    console.log(`Sacramento County at canvas: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    const withinX = pt!.x > 10 && pt!.x < canvasRect!.width - 10;
    const withinY = pt!.y > 10 && pt!.y < canvasRect!.height - 10;
    if (!withinX || !withinY) {
      console.log("Sacramento County not in viewport; releasing and skipping");
      resolveZipDelay();
      return;
    }

    type MapType = {
      queryRenderedFeatures: (pt: [number, number], opts: Record<string, unknown>) => Array<{ properties?: Record<string, unknown> }>;
    };
    await page.waitForFunction(
      ({ x, y }: { x: number; y: number }) => {
        const map = (window as unknown as Record<string, unknown>).__hfaMap as MapType | undefined;
        if (!map) return false;
        try {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["county-boundary-fill"] });
          return feats.some(f => f.properties?.geoid === "06067");
        } catch { return false; }
      },
      { x: Math.round(pt!.x), y: Math.round(pt!.y) },
      { timeout: 10_000, polling: 300 },
    );
    console.log("Sacramento County polygon confirmed rendered ✓");

    // Click Sacramento County → handleCountySelect → selectedCountyGeoid="06067"
    // → ZIP boundary useEffect fires → intercepted and delayed → badge appears.
    await page.mouse.click(canvasRect!.x + pt!.x, canvasRect!.y + pt!.y);

    await expect(page.locator("[data-boundary-loading]")).toBeVisible({ timeout: 5_000 });
    console.log("ZIP boundary loading badge appeared ✓");

    resolveZipDelay();

    await expect(page.locator("[data-boundary-loading]")).not.toBeVisible({ timeout: 20_000 });
    console.log("ZIP boundary loading badge disappeared ✓");
  });
});
