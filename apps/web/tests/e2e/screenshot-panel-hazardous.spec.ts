import { test } from "@playwright/test";

test("screenshot detail panel for highest-AQI visible ZIP", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaBoundariesLoaded === true,
    { timeout: 15000 },
  );

  // Debug: find out what layers are available and what features render at center
  const debug = await page.evaluate(() => {
    const map = (window as unknown as Record<string, unknown>).__hfaMap as {
      getStyle: () => { layers: Array<{ id: string }> };
      queryRenderedFeatures: (
        pt: [number, number],
        opts?: Record<string, unknown>,
      ) => Array<{ layer: { id: string }; properties: Record<string, unknown> }>;
    } | undefined;
    if (!map) return { error: "no map" };

    const layerIds = map.getStyle().layers.map((l) => l.id);
    // Query at canvas center without layer filter to see what's there
    const featsCenter = map.queryRenderedFeatures([500, 332]);
    return {
      allLayers: layerIds.filter((id) => id.includes("zip") || id.includes("boundary")),
      featuresAtCenter: featsCenter.slice(0, 5).map((f) => ({
        layer: f.layer.id,
        props: f.properties,
      })),
    };
  });

  console.log("ZIP-related layers:", JSON.stringify(debug));

  // Scan using whatever layer IDs are present
  const fillLayerId = (debug as { allLayers?: string[] }).allLayers?.find((id) =>
    id.toLowerCase().includes("fill"),
  ) ?? "zip-fill";

  const result = await page.evaluate((layerId: string) => {
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
          if (p?.zip && !zipPts[p.zip]) {
            zipPts[p.zip] = { x, y, aqi: p.aqi ?? 0 };
          }
        }
      }
    }
    const best = Object.entries(zipPts).sort((a, b) => b[1].aqi - a[1].aqi)[0];
    return best ? { zip: best[0], ...best[1], all: Object.keys(zipPts) } : null;
  }, fillLayerId);

  console.log("Scan result:", JSON.stringify(result));
  if (!result) throw new Error("No ZIP polygons found on canvas");

  const canvas = page.locator(".mapboxgl-canvas").first();
  await canvas.click({ position: { x: result.x, y: result.y }, force: true });

  await page.waitForSelector('aside[aria-hidden="false"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  const panel = page.locator('aside[aria-hidden="false"]');
  await panel.screenshot({
    path: "tests/e2e/screenshots/detail-panel-hazardous.png",
  });
});
