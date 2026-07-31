import { test } from "@playwright/test";

test("screenshot detail panel with cigarette card", async ({ page }) => {
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

  // Poll until a data ZIP polygon appears in the viewport (handles slow flyTo + tile load).
  type ScanResult = { zip: string; x: number; y: number } | null;
  const handle = await page.waitForFunction(
    (): ScanResult => {
      const map = (window as unknown as Record<string, unknown>).__hfaMap as {
        queryRenderedFeatures: (
          pt: [number, number],
          opts: Record<string, unknown>,
        ) => Array<{ properties: { zip?: string; aqi?: number; hasData?: number } }>;
      } | undefined;
      if (!map) return null;

      for (let y = 20; y < 640; y += 15) {
        for (let x = 20; x < 980; x += 15) {
          const feats = map.queryRenderedFeatures([x, y], { layers: ["zip-boundary-fill"] });
          if (feats.length > 0) {
            const p = feats[0].properties;
            if (p?.zip && p.hasData) return { zip: p.zip, x, y };
          }
        }
      }
      return null;
    },
    undefined,
    { timeout: 15_000, polling: 400 },
  );

  const scanResult = await handle.jsonValue() as ScanResult;
  console.log("First data ZIP found:", JSON.stringify(scanResult));
  if (!scanResult) throw new Error("No data ZIP found on canvas");

  const canvas = page.locator(".mapboxgl-canvas").first();
  await canvas.click({ position: { x: scanResult.x, y: scanResult.y }, force: true });

  await page.waitForSelector('aside[aria-hidden="false"]', { timeout: 8000 });
  await page.waitForTimeout(600);

  const panel = page.locator('aside[aria-hidden="false"]');
  await panel.screenshot({
    path: "tests/e2e/screenshots/detail-panel-cigarette.png",
  });
});
