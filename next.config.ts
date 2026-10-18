import type { NextConfig } from "next";

const testSchema =
  process.env.AIMTHREAD_TEST_SCHEMA ?? process.env.TIMEOS_TEST_SCHEMA;
const isIsolated =
  testSchema && /^(aimthread|timeos)_test_[a-f0-9]{32}$/.test(testSchema);

const nextConfig: NextConfig = {
  ...(isIsolated ? { distDir: `.next-tests/${testSchema}` } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  // OAuth callback URLs contain short-lived codes and signed authorization
  // context. Keep them out of Next's development request logs too.
  logging: {
    incomingRequests: {
      ignore: [
        /^\/api\/auth(?:\/|\?)/,
        /^\/login(?:\?|$)/,
        /^\/oauth\/consent(?:\?|$)/,
      ],
    },
  },
  reactCompiler: true,
};

export default nextConfig;
