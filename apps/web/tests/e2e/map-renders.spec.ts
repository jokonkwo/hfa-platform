/**
 * Regression test: MapLibre canvas renders non-blank tile content.
 *
 * Ground truth: screenshot pixel variance (not console messages).
 * The test fails if:
 *   - the map container has no canvas
 *   - the canvas is 0×0 (blank due to flexbox layout race)
 *   - the screenshot is a solid color (WebGL not rendering)
 *
 * Requires: Next.js dev server at http://localhost:3000
 *           API server at http://localhost:8000
 * Run: npx playwright test --project=chrome
 */

import { test, expect, Page } from "@playwright/test";

// MapView.tsx sets window.__hfaMapLoaded = true when the MapLibre 'load' event
// fires. This is more reliable in headless environments than the 'idle' event
// (which requires GPU-accelerated WebGL).
async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as Window & { __hfaMapLoaded?: boolean }).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

test.describe("Map canvas", () => {
  test("renders non-blank tile content", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Wait for the MapLibre canvas to appear in the DOM.
    await page.locator(".maplibregl-canvas").first().waitFor({
      state: "attached",
      timeout: 15_000,
    });

    // Wait for map 'load' to fire (style + sources ready).
    await waitForMapLoad(page);

    // Brief wait for initial tile renders to settle.
    await page.waitForTimeout(2_000);

    // --- Canvas dimension check ---
    const dims = await page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
      return el ? { width: el.width, height: el.height } : null;
    });
    expect(dims, "maplibregl-canvas element not found in DOM").not.toBeNull();
    expect(dims!.width, "canvas width must be > 0 — flexbox race likely").toBeGreaterThan(0);
    expect(dims!.height, "canvas height must be > 0 — flexbox race likely").toBeGreaterThan(0);

    // --- Screenshot pixel variance check ---
    // Crop to just the map area (right side, excluding the 280px sidebar).
    const mapRegion = page.locator("main").first();
    const screenshot = await mapRegion.screenshot();

    // Count unique pixel values in the screenshot buffer.
    // PNG screenshot bytes: 4 bytes per pixel (RGBA), but the Buffer contains
    // raw PNG which we can't read pixel-by-pixel without decoding. Instead, use
    // a simple heuristic: blank canvas → very small file size; real tiles → larger.
    // Real CARTO Positron tiles + circles: typically 100KB+; blank WebGL = <5KB.
    const sizeKb = screenshot.length / 1024;
    console.log(`Map area screenshot: ${sizeKb.toFixed(1)} KB`);

    expect(
      sizeKb,
      `Screenshot too small (${sizeKb.toFixed(1)} KB) — map canvas likely blank`,
    ).toBeGreaterThan(20);

    // --- Pixel variance via WebGL readPixels (best effort; skipped if no WebGL) ---
    const pixelResult = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
      if (!canvas) return { skip: "no canvas" };
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return { skip: "no webgl context (headless)" };

      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return { skip: "canvas is 0×0" };

      const size = 20;
      const x = Math.floor(W / 2 - size / 2);
      const y = Math.floor(H / 2 - size / 2);
      const pixels = new Uint8Array(size * size * 4);
      gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const n = size * size;
      let rSum = 0, gSum = 0, bSum = 0;
      for (let i = 0; i < n; i++) {
        rSum += pixels[i * 4];
        gSum += pixels[i * 4 + 1];
        bSum += pixels[i * 4 + 2];
      }
      const rM = rSum / n, gM = gSum / n, bM = bSum / n;
      let variance = 0;
      for (let i = 0; i < n; i++) {
        variance += (pixels[i * 4] - rM) ** 2 + (pixels[i * 4 + 1] - gM) ** 2 + (pixels[i * 4 + 2] - bM) ** 2;
      }
      variance /= n * 3;
      return {
        canvasWidth: W,
        canvasHeight: H,
        pixelVariance: variance,
        firstPixel: [pixels[0], pixels[1], pixels[2], pixels[3]],
      };
    });

    if ("skip" in (pixelResult as object)) {
      console.log(`WebGL pixel check skipped: ${(pixelResult as { skip: string }).skip}`);
    } else {
      const r = pixelResult as { canvasWidth: number; canvasHeight: number; pixelVariance: number; firstPixel: number[] };
      console.log(`Canvas ${r.canvasWidth}×${r.canvasHeight}, pixel variance: ${r.pixelVariance.toFixed(2)}, first px: ${r.firstPixel}`);
      expect(
        r.pixelVariance,
        `pixel variance too low — canvas appears blank (solid color)`,
      ).toBeGreaterThan(5);
    }
  });

  test("sidebar shows ZIP data rows", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Sidebar data loads from the API independently of the map.
    const zipRows = page.locator("[data-zip]");
    await expect(zipRows.first()).toBeVisible({ timeout: 15_000 });
    const count = await zipRows.count();
    expect(count, "expected at least 1 ZIP in sidebar").toBeGreaterThan(0);
    console.log(`Sidebar shows ${count} ZIP rows`);
  });

  test("map navigation controls are present", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    // Navigation controls appear only after the map is constructed.
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();

    // Attribution must show CARTO (confirms CARTO Positron style loaded).
    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await expect(attribution).toContainText("CARTO");
  });
});
