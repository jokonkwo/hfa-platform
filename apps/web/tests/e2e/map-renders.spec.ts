/**
 * Regression tests: MapLibre canvas rendering, AQI colors, and hover interaction.
 *
 * Ground truth is runtime pixel observation via WebGL readPixels + DOM state checks.
 * Tests are intentionally NOT model-based (no snapshots) — they assert invariants
 * that survive cosmetic changes while catching real regressions:
 *   - canvas non-blank, correct size
 *   - chromatic content (catches wrong monochrome basemap)
 *   - pastel AQI colors present, old saturated colors absent
 *   - hover feature state and tooltip appear on mousemove
 *
 * Requires: Next.js dev server at http://localhost:3000
 *           API server at http://localhost:8000
 * Run: npx playwright test --project=chrome
 */

import { test, expect, Page } from "@playwright/test";

// ─── helpers ───────────────────────────────────────────────────────────────

type W = Window & typeof globalThis;

async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaMapLoaded?: boolean }).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function waitForBoundaries(page: Page, timeoutMs = 15_000) {
  await page.waitForFunction(
    () => (window as W & { __hfaBoundariesLoaded?: boolean }).__hfaBoundariesLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

/**
 * Sample pixels from the WebGL canvas. Returns null if canvas or context unavailable.
 * sampleStep: read every Nth pixel in each dimension (1 = full, 4 = 1/16th).
 */
async function sampleCanvasPixels(page: Page, sampleStep = 4) {
  return page.evaluate((step) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
    if (!canvas) return null;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return null;
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) return null;

    // Read a small sample from the center of the canvas.
    const sw = Math.floor(W / step);
    const sh = Math.floor(H / step);
    const buf = new Uint8Array(sw * sh * 4);
    // Read the whole canvas downsampled by reading a center region.
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(W * H * 4)); // prime buffer
    // Actually read in a grid pattern via a smaller region per row would be slow.
    // Instead read the full canvas and subsample in JS.
    const full = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, full);

    const pixels: { r: number; g: number; b: number }[] = [];
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const i = (y * W + x) * 4;
        pixels.push({ r: full[i], g: full[i + 1], b: full[i + 2] });
      }
    }
    return { pixels, canvasWidth: W, canvasHeight: H };
  }, sampleStep);
}

// ─── existing tests ─────────────────────────────────────────────────────────

test.describe("Map canvas", () => {
  test("renders non-blank tile content", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator(".maplibregl-canvas").first().waitFor({ state: "attached", timeout: 15_000 });
    await waitForMapLoad(page);
    await page.waitForTimeout(2_000);

    const dims = await page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
      return el ? { width: el.width, height: el.height } : null;
    });
    expect(dims, "maplibregl-canvas element not found in DOM").not.toBeNull();
    expect(dims!.width, "canvas width must be > 0 — flexbox race likely").toBeGreaterThan(0);
    expect(dims!.height, "canvas height must be > 0 — flexbox race likely").toBeGreaterThan(0);

    const mapRegion = page.locator("main").first();
    const screenshot = await mapRegion.screenshot();
    const sizeKb = screenshot.length / 1024;
    console.log(`Map area screenshot: ${sizeKb.toFixed(1)} KB`);
    expect(sizeKb, `Screenshot too small (${sizeKb.toFixed(1)} KB) — map canvas likely blank`).toBeGreaterThan(20);

    const sample = await sampleCanvasPixels(page, 4);
    if (sample) {
      const { pixels, canvasWidth, canvasHeight } = sample;
      const n = pixels.length;
      let rSum = 0, gSum = 0, bSum = 0;
      for (const p of pixels) { rSum += p.r; gSum += p.g; bSum += p.b; }
      const rM = rSum / n, gM = gSum / n, bM = bSum / n;
      let variance = 0;
      for (const p of pixels) {
        variance += (p.r - rM) ** 2 + (p.g - gM) ** 2 + (p.b - bM) ** 2;
      }
      variance /= n * 3;
      console.log(`Canvas ${canvasWidth}×${canvasHeight}, pixel variance: ${variance.toFixed(2)}, n=${n}`);
      expect(variance, "pixel variance too low — canvas appears blank").toBeGreaterThan(5);
    }
  });

  test("sidebar shows ZIP data rows", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const zipRows = page.locator("[data-zip]");
    await expect(zipRows.first()).toBeVisible({ timeout: 15_000 });
    const count = await zipRows.count();
    expect(count, "expected at least 1 ZIP in sidebar").toBeGreaterThan(0);
    console.log(`Sidebar shows ${count} ZIP rows`);
  });

  test("map navigation controls are present", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await expect(page.locator(".maplibregl-ctrl-zoom-in")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await expect(attribution).toContainText("CARTO");
  });
});

// ─── color diversity: catches monochrome basemap regression ─────────────────

test.describe("Color diversity", () => {
  test("Voyager basemap has chromatic pixel content (not monochrome)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await page.waitForTimeout(2_500);

    const sample = await sampleCanvasPixels(page, 4);
    expect(sample, "WebGL pixel sampling unavailable").not.toBeNull();

    const { pixels } = sample!;

    // Chroma = max(R,G,B) - min(R,G,B). Monochrome: chroma ≈ 0. Colorful: high chroma.
    let chromaSum = 0;
    let highChromaCount = 0;
    for (const { r, g, b } of pixels) {
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      chromaSum += chroma;
      if (chroma > 15) highChromaCount++;
    }
    const meanChroma = chromaSum / pixels.length;
    const chromaFraction = highChromaCount / pixels.length;
    console.log(
      `Mean chroma: ${meanChroma.toFixed(2)}, high-chroma fraction: ${(chromaFraction * 100).toFixed(1)}%`,
    );

    // Voyager has green parks, blue water, tan roads — mean chroma must exceed 5.
    // A monochrome style (Positron) would have mean chroma < 3.
    // This threshold catches the "wrong basemap" mistake.
    expect(
      meanChroma,
      `Mean chroma ${meanChroma.toFixed(2)} too low — looks monochrome; check basemap style URL`,
    ).toBeGreaterThan(5);
  });
});

// ─── pastel AQI color check ─────────────────────────────────────────────────

test.describe("AQI color palette", () => {
  test("pastel AQI colors present, old saturated EPA colors absent", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    await page.waitForTimeout(2_000);

    const result = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
      if (!canvas) return { error: "no canvas" };
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return { error: "no webgl" };
      const W = canvas.width, H = canvas.height;
      const full = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, full);

      // Old saturated EPA Good color: rgb(0, 228, 0) — bright chartreuse green.
      // New pastel Good rendered on Voyager background (0.35 opacity blend):
      //   ~rgb(211, 238, 215) — muted green.
      // Look for pixels that appear to be a greenish AQI color (G dominant, non-trivial saturation).

      let foundPastelGreen = false;
      let foundOldSaturatedGreen = false;

      for (let i = 0; i < full.length; i += 4) {
        const r = full[i], g = full[i + 1], b = full[i + 2];
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);

        // Old EPA bright green: very low R, very high G, very low B, extreme saturation.
        // Threshold: R < 50, G > 200, B < 50 — even at 0.35 opacity on any background,
        // the green channel would still dominate strongly.
        if (r < 80 && g > 200 && b < 80) {
          foundOldSaturatedGreen = true;
        }

        // New pastel Good: G > R > B, moderate chroma (rendered at ~35% opacity → muted).
        // Look for soft greenish pixels: G is highest channel, moderate R, low-ish B.
        // Blended on Voyager: R≈200-220, G≈230-245, B≈200-215, chroma≈20-40.
        if (g > r && g > b && r > 180 && g > 215 && chroma > 15 && chroma < 80) {
          foundPastelGreen = true;
        }
      }

      return { foundPastelGreen, foundOldSaturatedGreen };
    });

    expect(result, "pixel evaluation failed").not.toHaveProperty("error");
    const { foundPastelGreen, foundOldSaturatedGreen } = result as {
      foundPastelGreen: boolean;
      foundOldSaturatedGreen: boolean;
    };

    console.log(`Pastel green found: ${foundPastelGreen}, old saturated green: ${foundOldSaturatedGreen}`);

    expect(
      foundOldSaturatedGreen,
      "found old EPA saturated green (rgb~0,228,0) — AQI colors not updated",
    ).toBe(false);

    expect(
      foundPastelGreen,
      "no pastel green AQI pixels found — boundaries may not be rendering or colors regressed",
    ).toBe(true);
  });
});

// ─── hover interaction ──────────────────────────────────────────────────────

test.describe("Boundary hover", () => {
  test("mousemove over ZIP polygon sets hover state and shows tooltip", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    // Let tiles render so boundaries are visible.
    await page.waitForTimeout(1_500);

    // Project the 93727 centroid (a "Good" ZIP with confirmed data) to canvas pixels.
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-119.7127, 36.7479] as [number, number],
    );
    expect(pt, "__hfaProjectLngLat not exposed — map may not have loaded").not.toBeNull();
    console.log(`93727 centroid projects to canvas px: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

    // Translate canvas-relative pixel to page-level coordinates.
    const canvasRect = await page.locator(".maplibregl-canvas").first().boundingBox();
    expect(canvasRect, "canvas bounding box not found").not.toBeNull();

    const pageX = canvasRect!.x + pt!.x;
    const pageY = canvasRect!.y + pt!.y;

    // Move mouse over the ZIP centroid.
    await page.mouse.move(pageX, pageY);

    // Wait for the hover state to register.
    type HoverW = W & { __hfaHoveredZip?: string };
    const hoveredZip = await page.waitForFunction(
      () => (window as HoverW).__hfaHoveredZip,
      { timeout: 5_000, polling: 200 },
    );
    const zipValue = await hoveredZip.jsonValue() as string;
    console.log(`Hovered ZIP: ${zipValue}`);
    expect(zipValue, "expected a ZIP code to be hovered").toBeTruthy();

    // Tooltip should now be visible in the DOM.
    const tooltip = page.locator("#hfa-hover-tooltip");
    await expect(tooltip).toBeVisible({ timeout: 2_000 });

    // Tooltip must show the ZIP code (e.g. "93727").
    const tooltipText = await tooltip.innerText();
    console.log(`Tooltip text: "${tooltipText}"`);
    expect(tooltipText).toContain(zipValue);

    // Move mouse off the map → hover clears, tooltip hides.
    await page.mouse.move(10, 10);
    const clearedZip = await page.evaluate(
      () => (window as HoverW).__hfaHoveredZip,
    );
    expect(clearedZip, "hover should clear when mouse leaves boundary").toBeFalsy();
  });
});
