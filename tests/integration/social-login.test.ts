import { randomUUID } from "node:crypto";
import { symmetricDecrypt } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { oauthCode } from "../fixtures/oauth-provider.mjs";
import { createAimThreadAuth } from "@/auth/create-auth";
import * as authSchema from "@/db/auth-schema";
import * as domainSchema from "@/db/schema";

const origin = "http://127.0.0.1:3010";
const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
});
const database = drizzle(pool, { schema: { ...authSchema, ...domainSchema } });
let auth: ReturnType<typeof createAimThreadAuth>;
const schema = process.env.AIMTHREAD_TEST_SCHEMA ?? "public";
beforeAll(async () => {
  await migrate(database, {
    migrationsFolder: process.env.AIMTHREAD_TEST_MIGRATIONS ?? "drizzle",
    migrationsSchema: schema === "public" ? "drizzle" : `${schema}_migrations`,
  });
  auth = createAimThreadAuth({
    database,
    origin,
    secret: "isolated-secret-that-is-at-least-32-characters",
    google: {
      clientId: "isolated-google-client",
      clientSecret: "isolated-google-secret",
    },
    github: {
      clientId: "isolated-github-client",
      clientSecret: "isolated-github-secret",
    },
  });
  await auth.$context;
});
afterAll(async () => {
  await pool.end();
});

type Profile = {
  id: string;
  email: string;
  verified: boolean;
  name?: string;
  failure?: boolean;
};
class Browser {
  cookies = new Map<string, string>();
  async request(path: string, body?: object) {
    const response = await auth.handler(
      new Request(new URL(path, origin), {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: [...this.cookies]
            .map(([key, value]) => `${key}=${value}`)
            .join("; "),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const pos = pair.indexOf("=");
      this.cookies.set(pair.slice(0, pos), pair.slice(pos + 1));
    }
    return response;
  }
  async begin(provider: "google" | "github", callbackURL = "/today") {
    const response = await this.request("/api/auth/sign-in/social", {
      provider,
      callbackURL,
      errorCallbackURL: "/login",
      disableRedirect: true,
    });
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    return `/api/auth/callback/${provider}?${new URLSearchParams({ state: url.searchParams.get("state")!, code: "placeholder" })}`;
  }
  async login(provider: "google" | "github", profile: Profile) {
    const callback = new URL(await this.begin(provider), origin);
    callback.searchParams.set("code", oauthCode(profile));
    return this.request(callback.pathname + callback.search);
  }
  async user() {
    const response = await this.request("/api/auth/get-session");
    return (await response.json())?.user;
  }
}
function profile(overrides: Partial<Profile> = {}): Profile {
  const id = randomUUID();
  return {
    id,
    email: `${id}@example.test`,
    verified: true,
    name: "测试用户",
    ...overrides,
  };
}

describe("social identity callbacks using the production auth configuration", () => {
  it.each(["google", "github"] as const)(
    "%s first login, stable identity, encrypted tokens and editable profile",
    async (provider) => {
      const person = profile({ name: `  ${"名".repeat(70)}  ` });
      const browser = new Browser();
      expect((await browser.login(provider, person)).status).toBe(302);
      const first = await browser.user();
      expect(first.name).toBe("名".repeat(40));
      await browser.request("/api/auth/update-user", { name: "自己的名称" });
      await browser.request("/api/auth/sign-out", {});
      expect(await browser.user()).toBeUndefined();
      await browser.login(provider, {
        ...person,
        email: `changed-${person.email}`,
      });
      expect(await browser.user()).toMatchObject({
        id: first.id,
        name: "自己的名称",
        email: person.email,
      });
      const result = await pool.query(
        "select * from account where user_id=$1",
        [first.id],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].access_token).not.toBe(oauthCode(person));
      expect(result.rows[0].refresh_token).not.toBe(
        `refresh-${oauthCode(person)}`,
      );
      const expected = oauthCode({
        ...person,
        email: `changed-${person.email}`,
      });
      expect(
        await symmetricDecrypt({
          key: "isolated-secret-that-is-at-least-32-characters",
          data: result.rows[0].access_token,
        }),
      ).toBe(expected);
      expect(
        await symmetricDecrypt({
          key: "isolated-secret-that-is-at-least-32-characters",
          data: result.rows[0].refresh_token,
        }),
      ).toBe(`refresh-${expected}`);
      expect(result.rows[0].id_token).toBeNull();
    },
  );

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    "same email links only if both are verified: local=%s incoming=%s",
    async (local, incoming) => {
      const email = `${randomUUID()}@example.test`;
      const first = new Browser();
      const second = new Browser();
      await first.login("google", profile({ email, verified: local }));
      const user = await first.user();
      const response = await second.login(
        "github",
        profile({ email: email.toUpperCase(), verified: incoming }),
      );
      const next = await second.user();
      if (local && incoming) expect(next.id).toBe(user.id);
      else {
        expect(next).toBeUndefined();
        expect(response.headers.get("location")).toContain("/login?error=");
      }
      expect(
        (await pool.query('select id from "user" where email=$1', [email]))
          .rows,
      ).toHaveLength(1);
      expect(
        (await pool.query("select id from account where user_id=$1", [user.id]))
          .rows,
      ).toHaveLength(local && incoming ? 2 : 1);
    },
  );

  it("different emails and existing independent identities stay independent", async () => {
    const a = profile();
    const b = profile();
    const first = new Browser();
    const second = new Browser();
    await first.login("google", a);
    await second.login("github", b);
    const userA = await first.user();
    const userB = await second.user();
    expect(userA.id).not.toBe(userB.id);
    await second.login("github", { ...b, email: a.email });
    expect((await second.user()).id).toBe(userB.id);
  });

  it("concurrent callbacks and replay cannot duplicate a User or a Login Identity", async () => {
    const person = profile();
    const a = new Browser();
    const b = new Browser();
    const responses = await Promise.all([
      a.login("google", person),
      b.login("google", person),
    ]);
    expect(
      responses.some(
        (response) => response.headers.get("location") === "/today",
      ),
    ).toBe(true);
    expect(
      (await pool.query('select id from "user" where email=$1', [person.email]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          "select id from account where provider_id=$1 and account_id=$2",
          ["google", person.id],
        )
      ).rows,
    ).toHaveLength(1);
    const callback = new URL(await a.begin("google"), origin);
    callback.searchParams.set("code", oauthCode(person));
    await a.request(callback.pathname + callback.search);
    await a.request(callback.pathname + callback.search);
    expect(
      (await pool.query('select id from "user" where email=$1', [person.email]))
        .rows,
    ).toHaveLength(1);
    // The same stable provider identity cannot be assigned to a different User.
    const owner = (
      await pool.query("select user_id from account where account_id=$1", [
        person.id,
      ])
    ).rows[0].user_id;
    await expect(
      pool.query(
        "insert into account (id,account_id,provider_id,user_id,updated_at) values ($1,$2,$3,$4,now())",
        [randomUUID(), person.id, "google", owner],
      ),
    ).rejects.toThrow();
  });

  it("cancellation, invalid state, token failures and external callbacks are recoverable without authentication", async () => {
    const browser = new Browser();
    const callback = new URL(await browser.begin("github"), origin);
    callback.searchParams.delete("code");
    callback.searchParams.set("error", "access_denied");
    expect(
      (await browser.request(callback.pathname + callback.search)).headers.get(
        "location",
      ),
    ).toContain("access_denied");
    expect(await browser.user()).toBeUndefined();
    expect(
      (
        await browser.request(
          "/api/auth/callback/google?state=invalid&code=invalid",
        )
      ).headers.get("location"),
    ).toContain("/login");
    await browser.login("google", profile({ failure: true }));
    expect(await browser.user()).toBeUndefined();
    expect(
      (
        await browser.request("/api/auth/sign-in/social", {
          provider: "google",
          callbackURL: "https://attacker.example",
        })
      ).status,
    ).toBe(403);
    await browser.login("github", profile({ name: " \n " }));
    expect((await browser.user()).name).toBe("AimThread 用户");
  });

  it("password registration/login and explicit account binding are unavailable", async () => {
    const browser = new Browser();
    for (const path of [
      "/sign-up/email",
      "/sign-in/email",
      "/link-social",
      "/unlink-account",
    ]) {
      expect(
        (
          await browser.request(`/api/auth${path}`, {
            email: "nobody@example.test",
            password: "not-a-real-password",
            name: "name",
            provider: "google",
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(await browser.user()).toBeUndefined();
  });
});
