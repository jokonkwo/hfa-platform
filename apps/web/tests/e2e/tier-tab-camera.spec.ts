/**
 * Tier-tab camera behavior regression tests.
 *
 * Fix 2 guard: Clicking the State / County / ZIP header tabs must NOT trigger
 * automatic camera movement. Camera movement must ONLY occur when driven by
 * user actions that target a specific place (search result selection, map click
 * that activates a region, fitToGeoid calls from the sidebar).
 */
import { test, expect, type Page } from "@playwright/test";

type MapInstance = {
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  isMoving(): boolean;
};

type W = Window & typeof globalThis & {
  __hfaMapLoaded?: boolean;
  __hfaMap?: MapInstance;
  __hfaTier?: string;
  __hfaCountyBoundariesLoaded?: boolean;
};

async function waitForMapLoad(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => (window as W).__hfaMapLoaded === true,
    { timeout: timeoutMs, polling: 300 },
  );
}

async function waitForCameraIdle(page: Page, timeoutMs = 8_000) {
  // Wait until the map reports it's no longer moving (fly-to settled)
  await page.waitForFunction(
    () => {
      const map = (window as W).__hfaMap;
      return map ? !map.isMoving() : false;
    },
    { timeout: timeoutMs, polling: 100 },
  );
}

async function getCamera(page: Page): Promise<{ zoom: number; lng: number; lat: number } | null> {
  return page.evaluate(() => {
    const map = (window as W).__hfaMap;
    if (!map) return null;
    const c = map.getCenter();
    return { zoom: map.getZoom(), lng: c.lng, lat: c.lat };
  });
}

test.describe("Tier tab clicks — no camera movement", () => {
  test("clicking State tab keeps camera stationary", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCameraIdle(page);

    const before = await getCamera(page);
    expect(before).not.toBeNull();
    console.log(`Before State tab: zoom=${before!.zoom.toFixed(3)} lng=${before!.lng.toFixed(4)} lat=${before!.lat.toFixed(4)}`);

    await page.getByRole("button", { name: "State", exact: true }).click();

    // Wait for tier to register, then a further pause for any animation
    await page.waitForFunction(
      () => (window as W).__hfaTier === "state",
      { timeout: 5_000, polling: 100 },
    );
    await waitForCameraIdle(page);

    const after = await getCamera(page);
    expect(after).not.toBeNull();
    console.log(`After State tab: zoom=${after!.zoom.toFixed(3)} lng=${after!.lng.toFixed(4)} lat=${after!.lat.toFixed(4)}`);

    // Camera must not have moved
    expect(Math.abs(after!.zoom - before!.zoom)).toBeLessThan(0.05);
    expect(Math.abs(after!.lng - before!.lng)).toBeLessThan(0.01);
    expect(Math.abs(after!.lat - before!.lat)).toBeLessThan(0.01);
    console.log("State tab click did not move the camera ✓");
  });

  test("clicking County tab keeps camera stationary", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    // Start in State tier
    await page.getByRole("button", { name: "State", exact: true }).click();
    await page.waitForFunction(
      () => (window as W).__hfaTier === "state",
      { timeout: 5_000, polling: 100 },
    );
    await waitForCameraIdle(page);

    const before = await getCamera(page);
    expect(before).not.toBeNull();
    console.log(`Before County tab: zoom=${before!.zoom.toFixed(3)} lng=${before!.lng.toFixed(4)} lat=${before!.lat.toFixed(4)}`);

    await page.getByRole("button", { name: "County", exact: true }).click();
    await page.waitForFunction(
      () => (window as W).__hfaTier === "county",
      { timeout: 5_000, polling: 100 },
    );
    await waitForCameraIdle(page);

    const after = await getCamera(page);
    expect(after).not.toBeNull();
    console.log(`After County tab: zoom=${after!.zoom.toFixed(3)} lng=${after!.lng.toFixed(4)} lat=${after!.lat.toFixed(4)}`);

    expect(Math.abs(after!.zoom - before!.zoom)).toBeLessThan(0.05);
    expect(Math.abs(after!.lng - before!.lng)).toBeLessThan(0.01);
    expect(Math.abs(after!.lat - before!.lat)).toBeLessThan(0.01);
    console.log("County tab click did not move the camera ✓");
  });

  test("cycling State → County → Zip → County keeps camera stationary throughout", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCameraIdle(page);

    const baseline = await getCamera(page);
    expect(baseline).not.toBeNull();
    console.log(`Baseline camera: zoom=${baseline!.zoom.toFixed(3)} lng=${baseline!.lng.toFixed(4)} lat=${baseline!.lat.toFixed(4)}`);

    const sequence: Array<{ tab: string; tier: string }> = [
      { tab: "State", tier: "state" },
      { tab: "County", tier: "county" },
      { tab: "Zip", tier: "zip" },
      { tab: "County", tier: "county" },
    ];

    for (const { tab, tier } of sequence) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await page.waitForFunction(
        (t: string) => (window as W).__hfaTier === t,
        tier,
        { timeout: 5_000, polling: 100 },
      );
      await waitForCameraIdle(page);
      const cam = await getCamera(page);
      expect(cam).not.toBeNull();
      expect(Math.abs(cam!.zoom - baseline!.zoom)).toBeLessThan(0.05);
      expect(Math.abs(cam!.lng - baseline!.lng)).toBeLessThan(0.01);
      expect(Math.abs(cam!.lat - baseline!.lat)).toBeLessThan(0.01);
      console.log(`After clicking "${tab}" tab: camera stationary ✓`);
    }
  });
});

test.describe("Search navigation — camera does move", () => {
  test("selecting a county search result flies camera to that county", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCameraIdle(page);

    const before = await getCamera(page);
    expect(before).not.toBeNull();
    console.log(`Before search: zoom=${before!.zoom.toFixed(3)} lng=${before!.lng.toFixed(4)} lat=${before!.lat.toFixed(4)}`);

    // Search for Fresno County
    const input = page.getByRole("textbox", { name: /search states/i });
    await input.fill("Fresno County");
    await page.waitForTimeout(500);

    const dropdown = page.locator("ul[role='listbox']");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    // Select the first county result for Fresno
    const countyResult = page.locator("ul[role='listbox'] button").filter({
      has: page.locator("span", { hasText: "County" }),
    }).filter({ hasText: "Fresno" }).first();
    await expect(countyResult).toBeVisible({ timeout: 5_000 });
    await countyResult.click({ force: true });

    // Wait for camera to settle after fly-to
    await waitForCameraIdle(page, 10_000);

    const after = await getCamera(page);
    expect(after).not.toBeNull();
    console.log(`After search selection: zoom=${after!.zoom.toFixed(3)} lng=${after!.lng.toFixed(4)} lat=${after!.lat.toFixed(4)}`);

    // Camera MUST have moved — at least one of zoom or center significantly changed
    const zoomDelta = Math.abs(after!.zoom - before!.zoom);
    const lngDelta = Math.abs(after!.lng - before!.lng);
    const latDelta = Math.abs(after!.lat - before!.lat);
    const cameraMoved = zoomDelta > 0.5 || lngDelta > 1.0 || latDelta > 1.0;
    expect(cameraMoved, `Camera should have moved: Δzoom=${zoomDelta.toFixed(3)} Δlng=${lngDelta.toFixed(3)} Δlat=${latDelta.toFixed(3)}`).toBe(true);
    console.log(`Search selection moved the camera: Δzoom=${zoomDelta.toFixed(2)}, Δlng=${lngDelta.toFixed(2)}, Δlat=${latDelta.toFixed(2)} ✓`);
  });

  test("selecting a state search result flies camera to that state", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForMapLoad(page);
    await waitForCameraIdle(page);

    const before = await getCamera(page);
    expect(before).not.toBeNull();

    const input = page.getByRole("textbox", { name: /search states/i });
    await input.fill("Texas");
    await page.waitForTimeout(500);

    const dropdown = page.locator("ul[role='listbox']");
    await expect(dropdown).toBeVisible({ timeout: 10_000 });

    const stateResult = page.locator("ul[role='listbox'] button").filter({
      has: page.locator("span", { hasText: "State" }),
    }).filter({ hasText: "Texas" }).first();
    await expect(stateResult).toBeVisible({ timeout: 5_000 });
    await stateResult.click({ force: true });

    await waitForCameraIdle(page, 10_000);

    const after = await getCamera(page);
    expect(after).not.toBeNull();

    const zoomDelta = Math.abs(after!.zoom - before!.zoom);
    const lngDelta = Math.abs(after!.lng - before!.lng);
    const latDelta = Math.abs(after!.lat - before!.lat);
    const cameraMoved = zoomDelta > 0.5 || lngDelta > 1.0 || latDelta > 1.0;
    expect(cameraMoved, `Camera should have moved to Texas: Δzoom=${zoomDelta.toFixed(3)} Δlng=${lngDelta.toFixed(3)} Δlat=${latDelta.toFixed(3)}`).toBe(true);
    console.log(`State search moved the camera: Δzoom=${zoomDelta.toFixed(2)}, Δlng=${lngDelta.toFixed(2)}, Δlat=${latDelta.toFixed(2)} ✓`);
  });
});
