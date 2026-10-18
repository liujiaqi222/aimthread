import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { mcpCall } from "./helpers";

test.use({ actionTimeout: 30_000 });

type Profile = { id: string; email: string; verified: boolean; name: string };
function person(): Profile {
  const id = randomUUID();
  return {
    id,
    email: `${id}@example.test`,
    verified: true,
    name: "社交登录用户",
  };
}
async function provider(page: Page, profile: Profile, cancel = false) {
  await page.route(
    /^https:\/\/(accounts\.google\.com\/o\/oauth2\/v2\/auth|github\.com\/login\/oauth\/authorize)\?/,
    async (route) => {
      const url = new URL(route.request().url());
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      if (cancel) callback.searchParams.set("error", "access_denied");
      else
        callback.searchParams.set(
          "code",
          Buffer.from(JSON.stringify(profile)).toString("base64url"),
        );
      await route.fulfill({
        status: 302,
        headers: { location: callback.toString() },
        body: "",
      });
    },
  );
}

test("Google first use, logout, verified GitHub return and account switching", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const a = person();
  const b = person();
  await provider(page, a);
  await page.goto("/login?next=/settings");
  await page.getByRole("button", { name: "使用 Google 继续" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel("时区").fill("Asia/Tokyo");
  await page.getByRole("button", { name: "完成设置" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("目标标题").fill("社交登录后自己的目标");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("我最期待的是").fill("验证自己的执行记录");
  await page.getByRole("button", { name: "保存目标，准备开始" }).click();
  await expect(page).toHaveURL(/\/today\?first=1$/);
  await page.goto("/settings");
  await page.getByLabel("你的名称").fill("已编辑名称");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByText("名称已保存。")).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/login?next=/settings");
  await provider(page, { ...a, id: randomUUID() });
  await page.getByRole("button", { name: "使用 GitHub 继续" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("你的名称")).toHaveValue("已编辑名称");
  await expect(page.getByLabel("时区")).toHaveValue("Asia/Tokyo");
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await provider(page, b);
  await page.getByRole("button", { name: "使用 Google 继续" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "完成设置" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel("目标标题")).toHaveValue("");
  await expect(
    page.getByText("社交登录后自己的目标", { exact: true }),
  ).toHaveCount(0);
});

test("cancelled and failed login can retry; unsafe destinations stay on site", async ({
  page,
}) => {
  const a = person();
  await page.goto("/login?client_id=untrusted&sig=invalid");
  await expect(page.getByText(/授权请求已失效或被修改/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 Google 继续" }),
  ).toHaveCount(0);
  await provider(page, a, true);
  await page.goto("/login?next=https://attacker.example");
  await page.getByRole("button", { name: "使用 GitHub 继续" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "登录已取消" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用 Google 继续" }),
  ).toBeEnabled();
  await provider(page, a);
  await page.getByRole("button", { name: "使用 Google 继续" }).click();
  await expect(page).toHaveURL(/\/setup$/);
});

test("ChatGPT authorization survives social login and still requires consent before MCP access", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const id = randomUUID();
  const clientId = `social-client-${id}`;
  const callbackURL = "https://client.example.test/callback";
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
  });
  try {
    await pool.query(
      `insert into oauth_client (id,client_id,name,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) values ($1,$2,'ChatGPT',$3,$4,$5,$6,'none',true)`,
      [
        id,
        clientId,
        [callbackURL],
        ["aimthread:read", "aimthread:write", "offline_access"],
        ["authorization_code", "refresh_token"],
        ["code"],
      ],
    );
    await pool.query(
      `insert into oauth_resource (id,identifier,name,allowed_scopes) values ($1,$2,'AimThread MCP',$3) on conflict (identifier) do nothing`,
      [
        randomUUID(),
        "http://127.0.0.1:3010/mcp",
        ["aimthread:read", "aimthread:write"],
      ],
    );
    await pool.query(
      `insert into oauth_client_resource (id,client_id,resource_id) values ($1,$2,$3)`,
      [randomUUID(), clientId, "http://127.0.0.1:3010/mcp"],
    );
    const verifier =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackURL,
      response_type: "code",
      scope: "aimthread:read aimthread:write offline_access",
      resource: "http://127.0.0.1:3010/mcp",
      state: "external-client-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    await provider(page, person());
    await page.route(`${callbackURL}**`, (route) =>
      route.fulfill({ body: "Authorized callback received" }),
    );
    await page.goto(`/api/auth/oauth2/authorize?${query}`);
    await expect(
      page.getByText("登录后继续连接 ChatGPT", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "使用 Google 继续" }).click();
    await expect(
      page.getByRole("heading", { name: "连接 ChatGPT" }),
    ).toBeVisible();
    expect(
      (
        await pool.query("select id from oauth_consent where client_id=$1", [
          clientId,
        ])
      ).rows,
    ).toHaveLength(0);
    await page.getByRole("button", { name: "允许连接" }).click();
    await expect(page).toHaveURL(
      /^https:\/\/client\.example\.test\/callback\?/,
    );
    const result = new URL(page.url());
    expect(result.searchParams.get("state")).toBe("external-client-state");
    const tokenResponse = await request.post("/api/auth/oauth2/token", {
      form: {
        grant_type: "authorization_code",
        client_id: clientId,
        redirect_uri: callbackURL,
        code: result.searchParams.get("code")!,
        code_verifier: verifier,
        resource: "http://127.0.0.1:3010/mcp",
      },
    });
    expect(tokenResponse.status()).toBe(200);
    const { access_token: token } = await tokenResponse.json();
    const response = await mcpCall(request, token, 1, "goal_create", {
      title: "从授权后的 MCP 创建",
    });
    expect(response.result.structuredContent.ok).toBe(true);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/setup$/);
  } finally {
    await pool.end();
  }
});
