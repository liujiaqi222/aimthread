import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/auth/same-origin";

describe("browser authority checks", () => {
  it("accepts the browser Host when Next uses an internal hostname", () => {
    expect(
      isSameOriginRequest(
        new Request("http://localhost:3010/api/session/transition", {
          headers: { host: "127.0.0.1:3010", origin: "http://127.0.0.1:3010" },
        }),
      ),
    ).toBe(true);
  });
  it.each([
    "https://foreign.example",
    "http://aimthread.example:3000",
    "http://aimthread.example",
    "null",
    "",
  ])("rejects a mismatched or missing origin: %s", (origin) => {
    expect(
      isSameOriginRequest(
        new Request("https://internal.example/api/session/transition", {
          headers: { host: "aimthread.example", origin },
        }),
      ),
    ).toBe(false);
  });
  it("accepts HTTPS same-origin and ignores spoofed forwarding authority", () => {
    expect(
      isSameOriginRequest(
        new Request("https://internal.example/api/session/transition", {
          headers: {
            host: "aimthread.example",
            origin: "https://aimthread.example",
            "x-forwarded-host": "foreign.example",
          },
        }),
      ),
    ).toBe(true);
  });
});
