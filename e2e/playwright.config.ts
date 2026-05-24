import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 21 — Playwright config.
 *
 * Pointed at the running docker-compose stack by default.
 * Override BASE_URL to run against a staging or CI environment.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,    // tests share seeded data so serial keeps state predictable
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    trace:    "on-first-retry",
    video:    "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },
  expect: {
    timeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
