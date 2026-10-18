import { defineConfig, devices } from "@playwright/test";

const testSchema =
  process.env.AIMTHREAD_TEST_SCHEMA ?? process.env.TIMEOS_TEST_SCHEMA;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: testSchema ? 120_000 : 30_000,
  expect: { timeout: testSchema ? 30_000 : 5_000 },
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3010",
    // Fail a stale locator promptly instead of waiting for a long workflow's full timeout.
    actionTimeout: 30_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --port 3010",
    url: "http://127.0.0.1:3010/login",
    reuseExistingServer: !process.env.CI && !testSchema,
    timeout: 120_000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:55432/aimthread_test",
      BETTER_AUTH_SECRET:
        "better-auth-test-secret-that-is-at-least-32-characters",
      BETTER_AUTH_URL: "http://127.0.0.1:3010",
    },
  },
});
