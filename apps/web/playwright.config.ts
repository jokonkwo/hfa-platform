import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 1,    // one retry for interaction-heavy tests that can be flaky under parallel load
  workers: 2,    // cap at 2 workers; 4 workers cause contention on dev server + MotherDuck
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    // Use installed Google Chrome — avoids the Playwright browser download requirement.
    channel: "chrome",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  // Do not start a local dev server automatically; assumes it is already running.
});
