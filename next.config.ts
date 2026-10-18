import type { NextConfig } from "next";

const testSchema =
  process.env.AIMTHREAD_TEST_SCHEMA ?? process.env.TIMEOS_TEST_SCHEMA;
const isIsolated =
  testSchema && /^(aimthread|timeos)_test_[a-f0-9]{32}$/.test(testSchema);

const nextConfig: NextConfig = {
  ...(isIsolated ? { distDir: `.next-tests/${testSchema}` } : {}),
  devIndicators: isIsolated ? false : { position: "bottom-right" },
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
};

export default nextConfig;
