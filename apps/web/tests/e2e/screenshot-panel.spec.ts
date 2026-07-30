import { test } from "@playwright/test";

test("screenshot detail panel with cigarette card", async ({ page }) => {
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Wait for boundaries to load
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__hfaBoundariesLoaded === true,
    { timeout: 15000 },
  );

  // Click the canvas at a point that should hit a ZIP polygon
  // 93727 was verified at canvas px (608,314) in prior sessions
  const canvas = page.locator(".mapboxgl-canvas").first();
  await canvas.click({ position: { x: 608, y: 314 } });

  // Wait for the detail panel to slide in (translate-x-0 means visible)
  await page.waitForSelector('aside[aria-hidden="false"]', { timeout: 5000 });
  await page.waitForTimeout(600); // let CSS transition settle

  // Screenshot just the detail panel (the one that slides in from the right)
  const panel = page.locator('aside[aria-hidden="false"]');
  await panel.screenshot({
    path: "tests/e2e/screenshots/detail-panel-cigarette.png",
  });
});
