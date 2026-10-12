import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/env/schema";
import { inferPublicOrigin } from "@/shared/public-origin";

const validEnvironment = {
  DATABASE_URL: "postgresql://aimthread:password@localhost:5432/aimthread",
  BETTER_AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://aimthread.example.com",
};

describe("server environment", () => {
  it("accepts a complete server-only configuration", () => {
    expect(parseServerEnvironment(validEnvironment)).toMatchObject(
      validEnvironment,
    );
  });

  it("rejects a weak BETTER_AUTH_SECRET", () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_SECRET: "too-short",
      }),
    ).toThrow();
  });

  it("allows HTTP only for local development", () => {
    expect(
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_URL: "http://127.0.0.1:3010",
      }).BETTER_AUTH_URL,
    ).toBe("http://127.0.0.1:3010");
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_URL: "http://aimthread.example.com",
      }),
    ).toThrow();
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        DATABASE_URL: "file:local.db",
      }),
    ).toThrow();
  });
});

describe("public origin inference", () => {
  it("uses the stable branch URL for Vercel previews", () => {
    expect(
      inferPublicOrigin({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "aimthread-git-feature.example.vercel.app",
        VERCEL_URL: "aimthread-random.example.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "aimthread.vercel.app",
      }),
    ).toBe("https://aimthread-git-feature.example.vercel.app");
  });

  it("uses the production URL for production deployments", () => {
    expect(
      inferPublicOrigin({
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "aimthread-git-main.example.vercel.app",
        VERCEL_URL: "aimthread-random.example.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "aimthread.example.com",
      }),
    ).toBe("https://aimthread.example.com");
  });
});
