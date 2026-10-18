import { expect, test } from "@playwright/test";

import { loginAndSetup } from "./helpers";

test("root redirects to the execution dashboard", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/today");
});

test("root reaches login without JavaScript when signed out", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(new URL("/", baseURL!).toString());

    await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
    await expect(
      page.getByRole("heading", { name: "AimThread", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("登录或创建账户", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("root opens the working app after login and setup", async ({ page }) => {
  await loginAndSetup(page);
  await page.goto("/");

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("button", { name: /开始第一次执行|开始专注/ }),
  ).toBeVisible();
});
