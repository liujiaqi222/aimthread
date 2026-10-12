// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SessionLink,
  SessionNavigationProvider,
  useSessionNavigation,
} from "@/components/session-navigation";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({
    onNavigate,
    href,
    children,
    ...props
  }: {
    onNavigate: (event: { preventDefault: () => void }) => void;
    href: string;
    children: React.ReactNode;
  }) =>
    createElement(
      "a",
      {
        ...props,
        href,
        onClick: (event: React.MouseEvent) => {
          event.preventDefault();
          let blocked = false;
          onNavigate({
            preventDefault: () => {
              blocked = true;
            },
          });
          if (!blocked) router.push(href);
        },
      },
      children,
    ),
}));

function Active({ finish }: { finish: () => Promise<boolean> }) {
  const { register } = useSessionNavigation();
  useEffect(() => register({ finish }), [register, finish]);
  return null;
}
function mount(finish?: () => Promise<boolean>) {
  window.history.replaceState(null, "", "/today");
  return render(
    createElement(
      SessionNavigationProvider,
      null,
      finish ? createElement(Active, { finish }) : null,
      createElement(SessionLink, { href: "/history" }, "足迹"),
      createElement(SessionLink, { href: "/today" }, "今天"),
    ),
  );
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps the timer running when staying or pressing Escape", () => {
  const finish = vi.fn().mockResolvedValue(true);
  mount(finish);
  fireEvent.click(screen.getByText("足迹"));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "继续计时" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByText("足迹"));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(finish).not.toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});
it("waits for save before navigating and prevents duplicate submissions", async () => {
  let resolve!: (value: boolean) => void;
  const finish = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  mount(finish);
  fireEvent.click(screen.getByText("足迹"));
  fireEvent.click(screen.getByRole("button", { name: "结束并离开" }));
  expect(router.push).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "正在处理…" }).hasAttribute("disabled"),
  ).toBe(true);
  resolve(true);
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith("/history", { scroll: undefined }),
  );
  expect(finish).toHaveBeenCalledTimes(1);
});
it("stays on the page after failure and allows retry", async () => {
  const finish = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  mount(finish);
  fireEvent.click(screen.getByText("足迹"));
  fireEvent.click(screen.getByRole("button", { name: "结束并离开" }));
  await screen.findByRole("alert");
  expect(router.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "结束并离开" }));
  await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
});
it("does not prompt on the current page or when idle", () => {
  const finish = vi.fn();
  const view = mount(finish);
  fireEvent.click(screen.getByText("今天"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(finish).not.toHaveBeenCalled();
  view.unmount();
  mount();
  fireEvent.click(screen.getByText("足迹"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("registers the native unload warning only while a session is present", () => {
  const view = mount(vi.fn());
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  view.unmount();
  mount();
  const idleEvent = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(idleEvent);
  expect(idleEvent.defaultPrevented).toBe(false);
});
it("blocks native history traversal until the session is saved", async () => {
  const navigation = Object.assign(new EventTarget(), { traverseTo: vi.fn() });
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  const finish = vi.fn().mockResolvedValue(true);
  const view = mount(finish);
  const event = Object.assign(new Event("navigate", { cancelable: true }), {
    navigationType: "traverse",
    destination: {
      key: "history-entry",
      url: "http://localhost:3000/history",
      sameDocument: true,
    },
  });
  navigation.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(navigation.traverseTo).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "结束并离开" }));
  await waitFor(() =>
    expect(navigation.traverseTo).toHaveBeenCalledWith("history-entry"),
  );
  expect(finish).toHaveBeenCalledTimes(1);
  view.unmount();
  Reflect.deleteProperty(window, "navigation");
});
