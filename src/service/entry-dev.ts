/**
 * Dev-only service entry. Runs the service as a plain Node process with a
 * loopback HTTP transport. This file is referenced only by entry-dev.ts
 * itself and is excluded from production builds (verified at build time).
 *
 * Filled out in #67. Stubbed here so the dev-mode wiring has a target.
 */
export function startDevService() {
  return { port: 0 }
}
