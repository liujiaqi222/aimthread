// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/profile-form";
import { userNameSchema } from "@/shared/schemas/profile";
import { authClient } from "@/auth/auth-client";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/auth/auth-client", () => ({
  authClient: {
    updateUser: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("User profile", () => {
  it("trims names and rejects blank or oversized values", () => {
    expect(userNameSchema.parse("  小刘  ")).toBe("小刘");
    for (const name of ["", "  ", "a".repeat(41), null]) {
      expect(userNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it("saves a name with Better Auth and refreshes the profile", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValue({
      data: { status: true },
      error: null,
    } as never);
    render(createElement(ProfileForm, { name: "AimThread 用户" }));
    fireEvent.change(screen.getByLabelText("你的名称"), {
      target: { value: " 小刘 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await screen.findByText("名称已保存。");
    expect(authClient.updateUser).toHaveBeenCalledWith({ name: "小刘" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("allows retry after a failed save without reporting success", async () => {
    vi.mocked(authClient.updateUser).mockRejectedValue(new Error("network"));
    render(createElement(ProfileForm, { name: "小刘" }));
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await screen.findByText("暂时无法连接，请稍后重试。");
    expect(screen.queryByText("名称已保存。")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "保存名称" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
