import { expect, test } from "@playwright/test";
import { loginAndSetup } from "./helpers";

test("sidebar collapse, keyboard expansion, route continuity, focus scene and mobile drawer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAndSetup(page);
  const sidebar = page.getByRole("complementary", { name: "侧边栏" });
  const toggle = page.getByRole("button", { name: "收起侧边栏" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveCSS("width", "216px");
  await toggle.click();
  await expect(sidebar.locator(".sidebar-label")).toHaveCount(0);
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(page.locator("main")).toHaveCSS("margin-left", "72px");
  await sidebar.getByRole("link", { name: "设置", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(sidebar).toHaveCSS("width", "72px");
  const expand = page.getByRole("button", { name: "展开侧边栏" });
  await page.mouse.move(600, 400);
  await expect(expand.locator(".sidebar-toggle-brand")).toBeVisible();
  await expect(expand.locator(".sidebar-toggle-expand")).toBeHidden();
  await expand.hover();
  await expect(expand.locator(".sidebar-toggle-brand")).toBeHidden();
  await expect(expand.locator(".sidebar-toggle-expand")).toBeVisible();
  await page.mouse.move(600, 400);
  await expand.focus();
  await expand.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(expand.locator(".sidebar-toggle-expand")).toBeVisible();
  await expand.press("Enter");
  await expect(sidebar).toHaveCSS("width", "216px");
  await sidebar.getByRole("link", { name: "今天", exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.reload(); // A fresh app session resumes automatic scene behavior.
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  await expect(page.locator(".focus-scene")).toBeVisible();
  await expect(sidebar).toHaveCSS("width", "72px");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(sidebar).toHaveCSS("width", "216px");
  await page.screenshot({ path: ".test-data/sidebar/focus-expanded.png" });
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(sidebar).toHaveCSS("width", "72px");
  await page.mouse.move(600, 400);
  await page.screenshot({ path: ".test-data/sidebar/focus-collapsed.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(sidebar).toBeHidden();
  await expect(page.locator("main")).toHaveCSS("margin-left", "0px");
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "今天", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭导航" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "取消本次执行", exact: true }).click();
  await page.getByRole("button", { name: "确定取消" }).click();
  await expect(
    page.getByRole("button", { name: /开始第一次执行|开始专注/ }),
  ).toBeVisible();
});
