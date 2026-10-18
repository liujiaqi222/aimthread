import { describe, expect, it } from "vitest";

import { safeReturnPath } from "@/auth/secrets";

describe("authentication secrets", () => {
  it("allows only local return paths", () => {
    expect(safeReturnPath("/settings?tab=mcp")).toBe("/settings?tab=mcp");
    expect(safeReturnPath("https://attacker.example")).toBe("/today");
    for (const path of [
      "//attacker.example",
      "/\\attacker.example",
      "/%2f%2fattacker.example",
      "/settings\n",
      "/api/auth/sign-out",
      "/auth/complete",
      "/oauth/consent",
      "/unknown",
    ]) {
      expect(safeReturnPath(path)).toBe("/today");
    }
  });
});
