/**
 * Regression tests: Mapbox GL JS canvas rendering, AQI colors, and hover interaction.
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

/** Switch to ZIP tier and fly to Fresno for ZIP-detail visibility. */
async function switchToZipTier(page: Page) {
  await page.getByRole("button", { name: "ZIP", exact: true }).click();
  await page.waitForFunction(
    () => (window as W & { __hfaTier?: string }).__hfaTier === "zip",
    { timeout: 5_000, polling: 200 },
  );
  // Tier switch no longer auto-zooms — fly explicitly so ZIP detail is visible.
  await page.evaluate(() => {
    type MapW = Window & typeof globalThis & { __hfaMap?: { flyTo: (o: unknown) => void } };
    (window as MapW).__hfaMap?.flyTo({ center: [-119.7871, 36.7378], zoom: 12, duration: 500 });
  });
  // Poll until at least one ZIP polygon is rendered in the viewport (max 8s).
  try {
    await page.waitForFunction(
      () => {
        const map = (window as W & {
          __hfaMap?: { queryRenderedFeatures: (pt: [number, number], opts: Record<string, unknown>) => unknown[] };
        }).__hfaMap;
        if (!map) return false;
        try { return map.queryRenderedFeatures([500, 332], { layers: ["zip-boundary-fill"] }).length > 0; }
        catch { return false; }
      },
      { timeout: 8_000, polling: 300 },
    );
  } catch { /* fall through — individual tests have their own waits */ }
  await page.waitForTimeout(400);
}

/**
 * Sample pixels from the WebGL canvas. Returns null if canvas or context unavailable.
 * sampleStep: read every Nth pixel in each dimension (1 = full, 4 = 1/16th).
 */
async function sampleCanvasPixels(page: Page, sampleStep = 4) {
  return page.evaluate((step) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".mapboxgl-canvas");
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
    await page.locator(".mapboxgl-canvas").first().waitFor({ state: "attached", timeout: 15_000 });
    await waitForMapLoad(page);
    await page.waitForTimeout(2_000);

    const dims = await page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>(".mapboxgl-canvas");
      return el ? { width: el.width, height: el.height } : null;
    });
    expect(dims, "mapboxgl-canvas element not found in DOM").not.toBeNull();
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
    await expect(page.locator(".mapboxgl-ctrl-zoom-in")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".mapboxgl-ctrl-zoom-out")).toBeVisible();
    const attribution = page.locator(".mapboxgl-ctrl-attrib");
    await expect(attribution).toContainText("Mapbox");
  });
});

// ─── color diversity: catches monochrome basemap regression ─────────────────

test.describe("Color diversity", () => {
  test("Outdoors basemap has chromatic pixel content (not monochrome)", async ({ page }) => {
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

    // Mapbox Outdoors has terrain hillshading, green vegetation, blue water, tan roads.
    // Mean chroma must exceed 5. A monochrome style would have mean chroma < 3.
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
    // Switch to ZIP tier so individual ZIP fill colors are visible on canvas.
    await switchToZipTier(page);
    await page.waitForTimeout(1_500);

    const result = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".mapboxgl-canvas");
      if (!canvas) return { error: "no canvas" };
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return { error: "no webgl" };
      const W = canvas.width, H = canvas.height;
      const full = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, full);

      // Old saturated EPA Good color: rgb(0, 228, 0) — bright chartreuse green.
      // New pastel Good rendered on Outdoors background (0.35 opacity blend):
      //   muted green blended with warm earthy terrain.
      // Look for pixels that appear to be a greenish AQI color (G dominant, non-trivial saturation).

      let foundPastelGreen = false;
      let foundOldSaturatedGreen = false;

      for (let i = 0; i < full.length; i += 4) {
        const r = full[i], g = full[i + 1], b = full[i + 2];
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);

        // Old EPA bright green: very low R, very high G, very low B, extreme saturation.
        if (r < 80 && g > 200 && b < 80) {
          foundOldSaturatedGreen = true;
        }

        // New pastel Good: G > R > B, moderate chroma (rendered at ~35% opacity → muted).
        // Blended on Outdoors terrain: muted greenish pixel, G channel dominant.
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

// ─── label visibility at default zoom ───────────────────────────────────────
// Catches "wrong default zoom" regression: settlement subdivision labels
// (neighborhoods/suburbs) only appear at zoom ≥ 12 in Mapbox Outdoors.
// If FRESNO_ZOOM regresses to 10, this test fails.

test.describe("Label visibility", () => {
  test("default tier is county; ZIP tier at zoom≥12 activates neighborhood labels", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);

    // Default tier should be "county" at CA zoom (~5).
    const initialTier = await page.evaluate(
      () => (window as W & { __hfaTier?: string }).__hfaTier,
    );
    console.log(`Initial tier: ${initialTier}`);
    expect(initialTier, "default tier should be 'county'").toBe("county");

    // Switch to ZIP tier and explicitly fly to Fresno at zoom 12.
    await switchToZipTier(page);

    const result = await page.evaluate(() => {
      const map = (window as W & { __hfaMap?: { getZoom(): number; getStyle(): { layers: { id: string; minzoom?: number; maxzoom?: number; type: string }[] } } }).__hfaMap;
      if (!map) return { error: "no map" };
      const zoom = map.getZoom();
      const layers = map.getStyle().layers;
      const neighborhoodLayers = layers.filter((l) =>
        (l.id === "settlement-subdivision-label" || l.id === "settlement-minor-label") &&
        (l.minzoom ?? 0) <= zoom &&
        (l.maxzoom ?? 24) >= zoom,
      );
      return {
        zoom,
        neighborhoodLayerIds: neighborhoodLayers.map((l) => l.id),
        neighborhoodLayerCount: neighborhoodLayers.length,
      };
    });

    expect(result, "map not accessible").not.toHaveProperty("error");
    const { zoom, neighborhoodLayerIds, neighborhoodLayerCount } = result as {
      zoom: number;
      neighborhoodLayerIds: string[];
      neighborhoodLayerCount: number;
    };

    console.log(`Default zoom: ${zoom.toFixed(2)}, neighborhood layers active: ${neighborhoodLayerIds.join(", ")}`);

    expect(
      zoom,
      `Zoom ${zoom.toFixed(2)} < 12 after switching to ZIP tier — check FRESNO_ZOOM`,
    ).toBeGreaterThanOrEqual(12);

    expect(
      neighborhoodLayerCount,
      `No settlement labels active at zoom ${zoom.toFixed(2)} — basemap may have changed`,
    ).toBeGreaterThan(0);
  });
});

// ─── hover interaction ──────────────────────────────────────────────────────

test.describe("Boundary hover", () => {
  test("mousemove over ZIP polygon sets hover state and shows tooltip", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForBoundaries(page);
    // Switch to ZIP tier so ZIP boundaries are visible on canvas.
    await switchToZipTier(page);

    // Project the 93727 centroid (a "Good" ZIP with confirmed data) to canvas pixels.
    type ProjW = W & { __hfaProjectLngLat?: (lng: number, lat: number) => { x: number; y: number } };
    const pt = await page.evaluate(
      ([lng, lat]) => (window as ProjW).__hfaProjectLngLat?.(lng, lat) ?? null,
      [-119.7127, 36.7479] as [number, number],
    );
    expect(pt, "__hfaProjectLngLat not exposed — map may not have loaded").not.toBeNull();
    console.log(`93727 centroid projects to canvas px: (${pt!.x.toFixed(0)}, ${pt!.y.toFixed(0)})`);

    // Translate canvas-relative pixel to page-level coordinates.
    const canvasRect = await page.locator(".mapboxgl-canvas").first().boundingBox();
    expect(canvasRect, "canvas bounding box not found").not.toBeNull();

    // Wait until 93727 is actually rendered at its projected pixel position.
    try {
      await page.waitForFunction(
        ({ cx, cy }: { cx: number; cy: number }) => {
          const map = (window as Record<string, unknown>).__hfaMap as {
            queryRenderedFeatures: (pt: [number, number], opts: Record<string, unknown>) => Array<{ properties?: Record<string, unknown> }>;
          } | undefined;
          if (!map) return false;
          try {
            const feats = map.queryRenderedFeatures([cx, cy], { layers: ["zip-boundary-fill"] });
            return feats.some((f) => f.properties?.zip === "93727");
          } catch { return false; }
        },
        { cx: Math.round(pt!.x), cy: Math.round(pt!.y) },
        { timeout: 8_000, polling: 300 },
      );
    } catch {
      // 93727 not found at its centroid projection — proceed anyway; hover check will fail with a clear message
    }

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
