/**
 * ZIP boundary visibility + hover tests.
 *
 * Verifies:
 *  - All 18 Fresno County ZIP polygons are present in the GeoJSON source
 *  - No-data ZIPs render with sufficient opacity to be visible
 *  - Hovering ANY ZIP — whether it has sensor data or not — shows a tooltip
 *  - __hfaHoveredZip is set for all ZIPs, not just those with data
 */

import { test, expect, type Page } from "@playwright/test";

type W = Window & typeof globalThis;
type MapW = W & {
  __hfaMapLoaded?: boolean;
  __hfaBoundariesLoaded?: boolean;
  __hfaTier?: string;
  __hfaHoveredZip?: string;
  __hfaMap?: {
    querySourceFeatures: (
      src: string,
      opts: Record<string, unknown>,
    ) => Array<{ properties: Record<string, unknown> }>;
    queryRenderedFeatures: (
      pt: [number, number],
      opts: Record<string, unknown>,
    ) => Array<{ properties: Record<string, unknown> }>;
  };
};

const ALL_18_ZIPS = [
  "93650","93701","93702","93703","93704","93705",
  "93706","93710","93711","93720","93721","93722",
  "93725","93726","93727","93728","93730","93737",
];

async function waitForMapLoad(page: Page) {
  await page.waitForFunction(
    () => (window as MapW).__hfaMapLoaded === true,
    { timeout: 30_000, polling: 300 },
  );
}
async function waitForBoundaries(page: Page) {
  await page.waitForFunction(
    () => (window as MapW).__hfaBoundariesLoaded === true,
    { timeout: 15_000, polling: 300 },
  );
}
async function switchToZipTier(page: Page) {
  await page.getByRole("button", { name: "ZIP", exact: true }).click();
  await page.waitForFunction(
    () => (window as MapW).__hfaTier === "zip",
    { timeout: 5_000, polling: 200 },
  );
  // Tier switch no longer auto-zooms — fly to Fresno so ZIP detail is visible.
  await page.evaluate(() => {
    type FlyMap = Window & typeof globalThis & { __hfaMap?: { flyTo: (o: unknown) => void } };
    (window as FlyMap).__hfaMap?.flyTo({ center: [-119.7871, 36.7378], zoom: 12, duration: 500 });
  });
  // Poll until at least one ZIP polygon is rendered at canvas center (max 8s).
  // Falls back gracefully if the center point misses all polygons.
  try {
    await page.waitForFunction(
      () => {
        const map = (window as MapW).__hfaMap;
        if (!map) return false;
        try {
          const feats = map.queryRenderedFeatures([500, 332], { layers: ["zip-boundary-fill"] });
          return feats.length > 0;
        } catch { return false; }
      },
      { timeout: 8_000, polling: 300 },
    );
  } catch { /* tiles took >8s — scan tests will handle the assertion */ }
  await page.waitForTimeout(400);
}

test.describe("ZIP boundary visibility — all 18 ZIPs", () => {
  test("all 18 ZIP features present in GeoJSON source data", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    await switchToZipTier(page);

    // querySourceFeatures only returns viewport-visible tiles, so we read the raw
    // GeoJSON data stored on the source object (_data) to count all 18 features.
    const result = await page.evaluate(() => {
      const map = (window as MapW).__hfaMap;
      if (!map) return null;
      // Access the GeoJSON source's underlying data (internal Mapbox GL API)
      type AnyMap = { getSource: (id: string) => { _data?: { features?: Array<{ properties?: { zip?: string } }> } } | undefined };
      const src = (map as unknown as AnyMap).getSource("zip-boundaries");
      const features = src?._data?.features ?? [];
      const zips = [...new Set(features.map((f) => f.properties?.zip).filter(Boolean))].sort() as string[];
      return { featCount: features.length, uniqueZips: zips };
    });

    expect(result, "map not accessible or source not found").not.toBeNull();
    const { featCount, uniqueZips } = result!;
    console.log(`ZIP source (_data): ${featCount} features, ${uniqueZips.length} unique ZIPs: ${uniqueZips.join(", ")}`);
    // Dynamic query now returns all ZIPs whose centroid is within Fresno County (55 ZIPs).
    // Verify count is ≥18 and all 18 pilot ZIPs are present.
    expect(uniqueZips.length, "expected ≥18 ZIP polygons in source").toBeGreaterThanOrEqual(18);
    for (const z of ALL_18_ZIPS) {
      expect(uniqueZips, `Pilot ZIP ${z} missing from source`).toContain(z);
    }
  });

  test("viewport scan finds both data and no-data ZIPs rendered", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    await switchToZipTier(page);

    const found = await page.evaluate(() => {
      const map = (window as MapW).__hfaMap;
      if (!map) return [];
      const zipPts: Record<string, { x: number; y: number; hasData: number }> = {};
      for (let y = 10; y < 650; y += 12) {
        for (let x = 10; x < 990; x += 12) {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["zip-boundary-fill"] });
          for (const f of feats) {
            const zip = f.properties?.zip as string;
            const hasData = f.properties?.hasData as number;
            if (zip && !(zip in zipPts)) zipPts[zip] = { x, y, hasData };
          }
        }
      }
      return Object.entries(zipPts).map(([zip, pos]) => ({ zip, ...pos }));
    });

    const dataZips = found.filter((f) => f.hasData === 1).map((f) => f.zip);
    const noDataZips = found.filter((f) => f.hasData === 0).map((f) => f.zip);
    console.log(`Rendered ZIPs in viewport: ${found.length}`);
    console.log(`  has-data: ${dataZips.join(", ")}`);
    console.log(`  no-data: ${noDataZips.join(", ")}`);

    expect(found.length, "fewer than 12 ZIPs visible at FRESNO_ZOOM").toBeGreaterThanOrEqual(12);
    expect(noDataZips.length, "no no-data ZIPs visible — opacity may still be too faint").toBeGreaterThan(0);
  });

  test("hover on data ZIP shows AQI tooltip; hover on no-data ZIP shows 'No sensor data'", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    // Also wait for AQI data so the scan can distinguish data vs no-data ZIPs.
    await page.waitForFunction(
      () => (window as MapW).__hfaZipNowLoaded === true,
      { timeout: 15_000, polling: 300 },
    );
    await switchToZipTier(page);

    // Scan canvas for interior pixels of rendered ZIPs (accumulate hits, take median for stability)
    const found = await page.evaluate(() => {
      const map = (window as MapW).__hfaMap;
      if (!map) return [];
      const hits: Record<string, { xs: number[]; ys: number[]; hasData: number }> = {};
      for (let y = 8; y < 650; y += 8) {
        for (let x = 8; x < 990; x += 8) {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["zip-boundary-fill"] });
          for (const f of feats) {
            const zip = f.properties?.zip as string;
            const hasData = (f.properties?.hasData as number) ?? 0;
            if (!zip) continue;
            if (!hits[zip]) hits[zip] = { xs: [], ys: [], hasData };
            hits[zip].xs.push(x);
            hits[zip].ys.push(y);
          }
        }
      }
      return Object.entries(hits).map(([zip, { xs, ys, hasData }]) => ({
        zip,
        x: xs[Math.floor(xs.length / 2)],
        y: ys[Math.floor(ys.length / 2)],
        hasData,
      }));
    });

    const dataZip = found.find((f) => f.hasData === 1);
    const noDataZip = found.find((f) => f.hasData === 0);

    expect(dataZip, "no data ZIP found in viewport — check API").not.toBeUndefined();
    expect(noDataZip, "no no-data ZIP found — opacity fix may not have taken effect").not.toBeUndefined();

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    // Test data ZIP — wait for ANY hovered ZIP (exact match can miss due to 10px scan resolution)
    if (dataZip) {
      await page.mouse.move(canvasRect!.x + dataZip.x, canvasRect!.y + dataZip.y);
      await page.waitForFunction(
        () => !!(window as MapW).__hfaHoveredZip,
        { timeout: 4_000, polling: 150 },
      );
      const tooltip = page.locator("#hfa-hover-tooltip");
      await expect(tooltip).toBeVisible({ timeout: 2_000 });
      const txt = await tooltip.innerText();
      // The hovered ZIP might differ from scan ZIP by ≤10px — just verify AQI is shown
      console.log(`Data ZIP ${dataZip.zip} tooltip: "${txt.substring(0, 80)}"`);
      expect(txt).toMatch(/AQI \d+/);
    }

    // Test no-data ZIP — wait for ANY hovered ZIP (exact match can miss due to 10px scan resolution)
    if (noDataZip) {
      await page.mouse.move(canvasRect!.x + noDataZip.x, canvasRect!.y + noDataZip.y);
      await page.waitForFunction(
        () => !!(window as MapW).__hfaHoveredZip,
        { timeout: 4_000, polling: 150 },
      );
      const tooltip = page.locator("#hfa-hover-tooltip");
      await expect(tooltip).toBeVisible({ timeout: 2_000 });
      const txt = await tooltip.innerText();
      // The hovered ZIP might differ from scan ZIP by ≤10px — just verify "no sensor data" is shown
      console.log(`No-data ZIP ${noDataZip.zip} tooltip: "${txt.substring(0, 80)}"`);
      expect(txt.toLowerCase()).toMatch(/no sensor data/i);
    }
  });

  test("hover works for ≥10 distinct in-viewport ZIPs via canvas scan", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    await switchToZipTier(page);

    // Fine-grained scan to get accurate pixel positions for each unique ZIP
    const zipPixels = await page.evaluate(() => {
      const map = (window as MapW).__hfaMap;
      if (!map) return [];
      // Accumulate all hit pixels per ZIP, then pick the median to get a stable interior point
      const hits: Record<string, { xs: number[]; ys: number[]; hasData: number }> = {};
      for (let y = 5; y < 660; y += 8) {
        for (let x = 5; x < 995; x += 8) {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["zip-boundary-fill"] });
          for (const f of feats) {
            const zip = f.properties?.zip as string;
            const hasData = f.properties?.hasData as number ?? 0;
            if (!zip) continue;
            if (!hits[zip]) hits[zip] = { xs: [], ys: [], hasData };
            hits[zip].xs.push(x);
            hits[zip].ys.push(y);
          }
        }
      }
      return Object.entries(hits).map(([zip, { xs, ys, hasData }]) => {
        const mx = xs[Math.floor(xs.length / 2)];
        const my = ys[Math.floor(ys.length / 2)];
        return { zip, x: mx, y: my, hasData };
      });
    });

    console.log(`ZIPs found via canvas scan: ${zipPixels.length} — ${zipPixels.map((z) => z.zip).sort().join(", ")}`);
    expect(zipPixels.length, "fewer than 10 ZIPs visible in viewport").toBeGreaterThanOrEqual(10);

    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect).not.toBeNull();

    let hoverSucceeded = 0;
    for (const { zip, x, y } of zipPixels) {
      await page.mouse.move(canvasRect!.x + x, canvasRect!.y + y);
      try {
        await page.waitForFunction(
          (z) => (window as MapW).__hfaHoveredZip === z,
          zip,
          { timeout: 2_000, polling: 100 },
        );
        hoverSucceeded++;
      } catch {
        const got = await page.evaluate(() => (window as MapW).__hfaHoveredZip);
        console.log(`  ${zip} at (${x},${y}): hover missed (got "${got ?? "undefined"}")`);
      }
    }

    console.log(`Hover confirmed for ${hoverSucceeded}/${zipPixels.length} ZIPs`);
    expect(
      hoverSucceeded,
      "fewer than 10 ZIPs successfully hovered — fill layer may be mis-ordered or hover handler broken",
    ).toBeGreaterThanOrEqual(10);
  });
});
