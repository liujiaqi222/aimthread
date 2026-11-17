import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  retries: 0,
  // Each test launches its own Electron instance against isolated data and
  // userData dirs; they must not share the single-instance lock concurrently.
  workers: 1,
  fullyParallel: false,
  use: { trace: 'on-first-retry' }
})
