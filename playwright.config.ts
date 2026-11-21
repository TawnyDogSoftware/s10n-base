/**
 * The browser journeys (`bun run test:e2e`): Chromium against the built server serving the built
 * web app, so the real security headers apply. Playwright starts the local database (compose),
 * applies the migrations, and starts the email capture server and the server on their own
 * ports, so a `bun dev` already running is left alone.
 *
 * No traces, videos or screenshots: email links carry tokens, and this repository is public, so
 * a failure is reported as text only.
 */
import { defineConfig, devices } from "@playwright/test";

import { E2E_ENV, E2E_ORIGIN, E2E_SES } from "./e2e/env";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: E2E_ORIGIN,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun scripts/ses-local/run.main.ts",
      url: `${E2E_SES}/health-check`,
      env: E2E_ENV,
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: [
        "docker compose -f docker-compose.local.yml up -d --wait",
        "bun apps/server/src/migrate.ts up",
        "node apps/server/dist/bin.mjs",
      ].join(" && "),
      url: `${E2E_ORIGIN}/ready`,
      env: E2E_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
    },
  ],
});
