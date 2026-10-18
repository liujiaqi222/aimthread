import { expect, test } from "@playwright/test";
import { createMcpAccessToken, loginAndSetup, mcpCall } from "./helpers";

test("calibrates task estimates and copies the same execution context exposed through MCP", async ({
  page,
  request,
  context,
}) => {
  await loginAndSetup(page);
  const token = await createMcpAccessToken(request);
  let id = 200;
  async function call(name: string, args: object) {
    const response = await mcpCall(request, token, id++, name, args);
    const result = response.result.structuredContent;
    expect(result.ok).toBe(true);
    return result.data;
  }
  const goal = await call("goal_create", { title: "AI context calibration" });
  const [task] = await call("tasks_create", {
    goalId: goal.id,
    tasks: [{ title: "Connect state management", estimatedMinutes: 120 }],
  });
  await call("session_log", {
    goalId: goal.id,
    taskId: task.id,
    durationSeconds: 16200,
    endedAt: new Date(Date.now() - 60_000).toISOString(),
    note: "接口已调通；卡点：等待设计确认",
    resumeHint: "下次写前端表单",
  });
  await page.goto("/goals");
  const card = page
    .locator("article")
    .filter({ hasText: "AI context calibration" });
  const row = card.locator("li").first();
  await expect(row).toContainText("已投入 4 小时 30 分钟");
  await row.getByRole("button", { name: "完成", exact: true }).click();
  await expect(row).toContainText("实际专注 4 小时 30 分钟");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await card.getByRole("button", { name: "复制给 AI", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "已复制，可粘贴给 AI" }),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("预计 2 小时 · 实际专注 4 小时 30 分钟");
  expect(copied).toContain("下次写前端表单");
  expect(copied).toContain("等待设计确认");
  const mcp = await call("goal_context_get", { goalId: goal.id });
  expect(mcp.report.tasks[0].focusSeconds).toBe(16200);
  expect(mcp.markdown.replace(/^生成时间：.*$/m, "")).toBe(
    copied.replace(/^生成时间：.*$/m, ""),
  );
  await row.getByRole("button", { name: "重新打开" }).click();
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  await row.getByLabel("预计分钟数").fill("240");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row).toContainText("预计 4 小时");
  await expect(row).toContainText("首次预估 2 小时");
  await card.screenshot({ path: "/tmp/aimthread-ai-context-desktop.png" });

  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException("Permission denied", "NotAllowedError"),
        ),
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await card.screenshot({ path: "/tmp/aimthread-ai-context-card-mobile.png" });
  await card.getByRole("button", { name: /已复制，可粘贴给 AI/ }).click();
  const dialog = page.getByRole("dialog", { name: "复制执行上下文" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("执行上下文 Markdown")).toContainText(
    "首次预估 2 小时",
  );
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 375);
  await page.screenshot({
    path: "/tmp/aimthread-ai-context-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
