import { test } from "@playwright/test";

test("screenshot detail panel with cigarette card", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaBoundariesLoaded === true,
    { timeout: 15000 },
  );

  // Switch to ZIP tier (default is county) so ZIP polygons are clickable.
  await page.getByRole("button", { name: "ZIP", exact: true }).click();
  await page.waitForTimeout(1200); // flyToFresno animation

  // Click the canvas at a point that should hit a ZIP polygon.
  // 93727 was verified at canvas px (608,314) at FRESNO_ZOOM=12, FRESNO_CENTER.
  const canvas = page.locator(".mapboxgl-canvas").first();
  await canvas.click({ position: { x: 608, y: 314 } });

  await page.waitForSelector('aside[aria-hidden="false"]', { timeout: 5000 });
  await page.waitForTimeout(600);

  const panel = page.locator('aside[aria-hidden="false"]');
  await panel.screenshot({
    path: "tests/e2e/screenshots/detail-panel-cigarette.png",
  });
});
