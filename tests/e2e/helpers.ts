import { createHash, createHmac, randomUUID } from "node:crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import * as authSchema from "@/db/auth-schema";

/** Web and MCP share an identity within a test; unrelated tests never share data. */
export function testUserId() {
  const info = test.info();
  return `e2e-${createHash("sha256").update(`${info.testId}:${info.retry}`).digest("hex").slice(0, 24)}`;
}
const testSecret = "better-auth-test-secret-that-is-at-least-32-characters";

function assertTestDatabase() {
  const namespace =
    process.env.AIMTHREAD_TEST_SCHEMA ?? process.env.TIMEOS_TEST_SCHEMA;
  const url = new URL(databaseUrl);
  if (
    !namespace?.match(/^(aimthread|timeos)_test_[a-f0-9]{32}$/) &&
    !(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.pathname.endsWith("_test")
    )
  ) {
    throw new Error("Test identities require an isolated test database.");
  }
}

export async function ensureTestUser(userId = testUserId()) {
  assertTestDatabase();
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(
      `insert into "user" (id,name,email,email_verified) values ($1,$1,$2,true) on conflict (id) do nothing`,
      [userId, `${userId}@example.test`],
    );
  } finally {
    await pool.end();
  }
}

/** Test-process-only fixture: a real persisted Better Auth session and signed cookie. */
export async function loginAs(page: Page, userId = testUserId()) {
  await ensureTestUser(userId);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const token = randomUUID();
  try {
    await pool.query(
      `insert into "session" (id,user_id,token,expires_at,updated_at) values ($1,$2,$3,now()+interval '1 hour',now())`,
      [randomUUID(), userId, token],
    );
  } finally {
    await pool.end();
  }
  await page.context().clearCookies();
  const signature = createHmac("sha256", testSecret)
    .update(token)
    .digest("base64");
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: encodeURIComponent(`${token}.${signature}`),
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
export const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "aimthread-e2e",
    version: "1.0.0",
  },
};

const baseUrl = "http://127.0.0.1:3010";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/aimthread_test";

export async function loginAndSetup(page: Page) {
  await loginAs(page);
  await page.goto("/setup");
  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/(onboarding|today)/);

  const destination = await expect
    .poll(async () => {
      if (new URL(page.url()).pathname === "/today") return "today";
      if (await page.getByLabel("目标标题").isVisible()) return "onboarding";
      return "waiting";
    })
    .toMatch(/^(today|onboarding)$/)
    .then(() =>
      new URL(page.url()).pathname === "/today" ? "today" : "onboarding",
    );

  if (destination === "onboarding") {
    await page.getByLabel("目标标题").fill("E2E baseline goal");
    await page.getByRole("button", { name: "保存目标，准备开始" }).click();
    await page.waitForURL(/\/today\?first=1/);
  }
  // A route URL can arrive before its streamed execution view is ready.
  await expect(
    page.getByRole("button", {
      name: /开始第一次执行|开始专注/,
    }),
  ).toBeVisible();
}

/**
 * Sign a short-lived test access token with the same key exposed by the
 * authorization server. This exercises the production JWT verification,
 * issuer, audience, and scope checks without pretending to be ChatGPT.
 * The actual browser OAuth exchange is verified manually against ChatGPT.
 */
export async function createMcpAccessToken(
  request: APIRequestContext,
  userId = testUserId(),
  claims: Record<string, unknown> = {},
  options: { audience?: string; issuer?: string; expirationTime?: string } = {},
) {
  await ensureTestUser(userId);
  const resourceMetadata = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(resourceMetadata.status()).toBe(200);
  const resource = (await resourceMetadata.json()) as {
    resource: string;
    authorization_servers: string[];
  };

  const issuer = resource.authorization_servers[0];
  expect(issuer).toBeTruthy();

  const serverMetadata = await request.get(
    "/.well-known/oauth-authorization-server/api/auth",
  );
  expect(serverMetadata.status()).toBe(200);
  const server = (await serverMetadata.json()) as { jwks_uri: string };

  // Asking for JWKS lazily creates the provider signing key on a fresh DB.
  const jwksPath = new URL(server.jwks_uri).pathname;
  const jwksResponse = await request.get(jwksPath);
  expect(jwksResponse.status()).toBe(200);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const signer = betterAuth({
      baseURL: baseUrl,
      secret: "better-auth-test-secret-that-is-at-least-32-characters",
      database: drizzleAdapter(drizzle(pool, { schema: authSchema }), {
        provider: "pg",
        schema: authSchema,
      }),
      plugins: [jwt()],
    });
    const signed = await signer.api.signJWT({
      body: {
        payload: {
          scope: "aimthread:read aimthread:write",
          client_id: "aimthread-e2e",
          sub: userId,
          ...claims,
        },
        overrideOptions: {
          jwt: {
            issuer: options.issuer ?? issuer!,
            audience: options.audience ?? resource.resource,
            expirationTime: options.expirationTime ?? "5m",
          },
        },
      },
    });
    return signed.token;
  } finally {
    await pool.end();
  }
}

export async function readMcpResponse(response: {
  headers(): Record<string, string>;
  text(): Promise<string>;
}) {
  const text = await response.text();
  if (!response.headers()["content-type"]?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line: string) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  return JSON.parse(data.at(-1) ?? "null");
}

export async function mcpCall(
  request: APIRequestContext,
  token: string,
  id: number,
  name: string,
  args: object,
) {
  const response = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args, _meta: mcpEnvelope },
    },
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
  });
  expect(response.status()).toBe(200);
  return readMcpResponse(response);
}
