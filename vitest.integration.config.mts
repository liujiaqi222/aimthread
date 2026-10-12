import { defineConfig } from "vitest/config";

const testSchema =
  process.env.AIMTHREAD_TEST_SCHEMA ?? process.env.TIMEOS_TEST_SCHEMA;

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: testSchema ? 180_000 : 20_000,
    hookTimeout: testSchema ? 90_000 : 30_000,
  },
});
