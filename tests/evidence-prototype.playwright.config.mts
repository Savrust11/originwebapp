import { defineConfig } from "@playwright/test";

/**
 * This config belongs only to the managed evidence-prototype group. It neither
 * launches a webServer nor points at an app URL; the test obtains its owned
 * loopback base URL from require-managed.mjs.
 */
export default defineConfig({
  testDir: "..",
  testMatch: [
    "tests/evidence-consultation-browser.test.mts",
    "tests/evidence-answer-browser.test.mts",
  ],
  timeout: 30_000,
  forbidOnly: true,
  fullyParallel: false,
  use: {
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    permissions: [],
  },
});