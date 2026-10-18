// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialLogin } from "@/components/social-login";
import { authClient } from "@/auth/auth-client";
import { initialSocialName } from "@/auth/social-profile";

vi.mock("@/auth/auth-client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const props = {
  callbackURL: "/auth/complete?next=%2Ftoday",
  errorCallbackURL: "/login?next=%2Ftoday",
  available: { google: true, github: true },
};

describe("social login recovery", () => {
  it("blocks repeated submissions for either provider while navigation is pending", () => {
    vi.mocked(authClient.signIn.social).mockReturnValue(new Promise(() => {}));
    render(<SocialLogin {...props} />);
    const google = screen.getByRole("button", { name: "使用 Google 继续" });
    fireEvent.click(google);
    fireEvent.click(google);
    fireEvent.click(screen.getByRole("button", { name: "使用 GitHub 继续" }));
    expect(authClient.signIn.social).toHaveBeenCalledTimes(1);
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: props.callbackURL,
      errorCallbackURL: props.errorCallbackURL,
    });
  });
  it("network failure releases both providers and permits retry", async () => {
    vi.mocked(authClient.signIn.social).mockRejectedValue(new Error("offline"));
    render(<SocialLogin {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "使用 Google 继续" }));
    await screen.findByText("暂时无法连接，请检查网络后重试。");
    fireEvent.click(screen.getByRole("button", { name: "使用 GitHub 继续" }));
    expect(authClient.signIn.social).toHaveBeenCalledTimes(2);
  });
  it("missing provider configuration offers a diagnostic without a fallback identity", () => {
    render(
      <SocialLogin {...props} available={{ google: false, github: false }} />,
    );
    expect(screen.getByText(/本站尚未配置/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "使用 Google 继续",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("normalizes optional provider names without blocking account creation", () => {
    expect(initialSocialName(null)).toBe("AimThread 用户");
    expect(initialSocialName(" \n\u0000 ")).toBe("AimThread 用户");
    expect(initialSocialName("  小刘  ")).toBe("小刘");
    expect(initialSocialName("字".repeat(100))).toHaveLength(40);
  });
});
