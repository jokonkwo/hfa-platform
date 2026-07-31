import { test } from "@playwright/test";

test("screenshot detail panel for highest-AQI visible ZIP", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaBoundariesLoaded === true,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaZipNowLoaded === true,
    { timeout: 10000 },
  );

  // Switch to ZIP tier and fly to Fresno (tier switch no longer auto-zooms).
  await page.getByRole("button", { name: "Zip", exact: true }).click();
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaTier === "zip",
    { timeout: 5000, polling: 200 },
  );
  await page.evaluate(() => {
    type MapW = Window & typeof globalThis & { __hfaMap?: { flyTo: (o: unknown) => void } };
    (window as MapW).__hfaMap?.flyTo({ center: [-119.7871, 36.7378], zoom: 12, duration: 500 });
  });

  const fillLayerId = "zip-boundary-fill";

  // Poll until a data ZIP polygon appears in the viewport (handles slow flyTo + tile load).
  type ScanResult = { zip: string; x: number; y: number; aqi: number; all: string[] } | null;
  const result = await page.waitForFunction(
    (layerId: string): ScanResult => {
      const map = (window as unknown as Record<string, unknown>).__hfaMap as {
        queryRenderedFeatures: (
          pt: [number, number],
          opts: Record<string, unknown>,
        ) => Array<{ properties: { zip?: string; aqi?: number; hasData?: number } }>;
      } | undefined;
      if (!map) return null;

      const zipPts: Record<string, { x: number; y: number; aqi: number }> = {};
      for (let y = 20; y < 640; y += 15) {
        for (let x = 20; x < 980; x += 15) {
          const feats = map.queryRenderedFeatures([x, y], { layers: [layerId] });
          if (feats.length > 0) {
            const p = feats[0].properties;
            if (p?.zip && p.hasData && !zipPts[p.zip]) {
              zipPts[p.zip] = { x, y, aqi: p.aqi ?? 0 };
            }
          }
        }
      }
      const best = Object.entries(zipPts).sort((a, b) => b[1].aqi - a[1].aqi)[0];
      return best ? { zip: best[0], ...best[1], all: Object.keys(zipPts) } : null;
    },
    fillLayerId,
    { timeout: 10_000, polling: 400 },
  );

  const scanResult = await result.jsonValue() as ScanResult;
  console.log("Scan result:", JSON.stringify(scanResult));
  if (!scanResult) throw new Error("No ZIP polygons with data found on canvas");

  const canvas = page.locator(".mapboxgl-canvas").first();
  await canvas.click({ position: { x: scanResult.x, y: scanResult.y }, force: true });

  await page.waitForSelector('aside[aria-hidden="false"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  const panel = page.locator('aside[aria-hidden="false"]');
  await panel.screenshot({
    path: "tests/e2e/screenshots/detail-panel-hazardous.png",
  });
});
