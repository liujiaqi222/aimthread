import { expect, test, type Page } from "@playwright/test";
import { loginAndSetup, createMcpAccessToken, mcpCall } from "./helpers";

async function navigate(page: Page, href: string) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .filter({ visible: true })
    .locator(`a[href="${href}"]`)
    .click();
}
async function clearActive(page: Page) {
  await page.goto("/today");
  const cancel = page.getByRole("button", {
    name: "取消本次执行",
    exact: true,
  });
  if (await cancel.isVisible()) {
    await cancel.click();
    await page.getByRole("button", { name: "确定取消" }).click();
  }
  await expect(
    page.getByRole("button", { name: /开始第一次执行|开始专注/ }),
  ).toBeVisible();
}

test("AI plan → goal/task picker → focus context → pause/note/recovery → completion and next task", async ({
  page,
  request,
}) => {
  await loginAndSetup(page);
  await clearActive(page);
  const token = await createMcpAccessToken(request);
  let seq = 100;
  const call = async (name: string, args: object) => {
    const response = await mcpCall(request, token, seq++, name, args);
    expect(response.result.structuredContent.ok).toBe(true);
    return response.result.structuredContent.data;
  };
  const goal = await call("goal_create", {
    title: "Ship Execution Loop",
    description: "完整执行流程",
  });
  const tasks = await call("tasks_create", {
    goalId: goal.id,
    tasks: [
      {
        title: "Write the first draft",
        description: "完成开头两个案例",
        resourceType: "url",
        resourceValue: "https://example.com/reference",
      },
      { title: "Review the second half" },
    ],
  });
  await page.reload();
  await page.getByRole("button", { name: "选择目标" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Ship Execution Loop/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Write the first draft" }),
  ).toBeVisible();
  await expect(page.getByText("完成开头两个案例")).toBeVisible();
  await expect(page.getByRole("link", { name: /example.com/ })).toHaveAttribute(
    "target",
    "_blank",
  );
  await page.getByRole("button", { name: "正计时", exact: true }).click();
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  await expect(page.locator(".focus-scene")).toBeVisible();
  await page.screenshot({
    path: ".test-data/redesign-task-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: ".test-data/redesign-task-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.reload();
  await expect(page.getByText("正计时已暂停")).toBeVisible();
  await expect(page.getByText("完成开头两个案例")).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const capture = page.getByLabel("快速记录");
  await capture.fill("Important thoughts during focus");
  await page.getByRole("button", { name: "记下", exact: true }).click();
  await expect(page.getByText("想法已保存")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "随手记", exact: true }).click();
  await expect(page.getByLabel("本次随手记")).toHaveValue(
    "Important thoughts during focus",
  );
  await page.getByRole("button", { name: "打断", exact: true }).click();
  await capture.fill("Urgent phone call");
  await page.getByRole("button", { name: "记下", exact: true }).click();
  await expect(page.getByText("Urgent phone call")).toBeVisible();
  await page.getByRole("button", { name: "结束并保存", exact: true }).click();
  await expect(page.getByText("专注已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "标记任务完成" }).click();
  await expect(page.getByRole("button", { name: "任务已完成" })).toBeVisible();
  await page.getByLabel("下次继续的第一步").fill("下次先补第二段例子");
  await page.getByRole("button", { name: "保存起点并返回" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the second half" }),
  ).toBeVisible();
  await expect(
    page.getByText("下次先补第二段例子", { exact: true }),
  ).toHaveCount(0);
  expect(tasks).toHaveLength(2);
});

test("goal-only execution keeps its hint after refresh and keyboard pause/resume", async ({
  page,
}) => {
  await loginAndSetup(page);
  await clearActive(page);
  await page.getByRole("button", { name: "更换任务" }).click();
  await page.getByRole("button", { name: "只围绕目标执行" }).click();
  await page.getByRole("button", { name: "正计时", exact: true }).click();
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await page.locator("body").click({ position: { x: 300, y: 20 } });
  await page.keyboard.press("Space");
  await expect(page.getByText("正计时已暂停")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByText("正计时中")).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "结束并保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "标记任务完成" })).toHaveCount(
    0,
  );
  await page.getByLabel("下次继续的第一步").fill("周三先跑五公里");
  await page.getByRole("button", { name: "保存起点并返回" }).click();
  await expect(
    page.getByRole("button", { name: /开始第一次执行|开始专注/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("周三先跑五公里")).toBeVisible();
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText("周三先跑五公里")).toBeVisible();
  await page.getByRole("button", { name: "取消本次执行", exact: true }).click();
  await page.getByRole("button", { name: "确定取消" }).click();
});

for (const width of [1280, 375])
  test(`active navigation guard, failure retry, and controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 812 });
    await loginAndSetup(page);
    await clearActive(page);
    await navigate(page, "/history");
    await navigate(page, "/today");
    await page
      .getByRole("button", {
        name: width === 375 ? "番茄钟" : "正计时",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeInViewport();
    await navigate(page, "/history");
    await expect(
      page.getByRole("dialog", { name: "计时进行中" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "继续计时", exact: true }).click();
    await page.evaluate(() => window.history.back());
    await expect(
      page.getByRole("dialog", { name: "计时进行中" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "继续计时", exact: true }).click();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续", exact: true }),
    ).toBeEnabled();
    await navigate(page, "/history");
    await page.route("**/api/session/finish", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { code: "DATABASE_UNAVAILABLE", message: "test failure" },
        }),
      }),
    );
    await page.getByRole("button", { name: "结束并离开" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/today/);
    await expect(
      page.getByRole("button", { name: "结束并离开" }),
    ).toBeEnabled();
    await page.unroute("**/api/session/finish");
    await page.getByRole("button", { name: "结束并离开" }).click();
    await expect(page).toHaveURL(/\/history/);
    expect(
      await (await page.request.get("/api/session/active")).json(),
    ).toMatchObject({ ok: true, data: null });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
