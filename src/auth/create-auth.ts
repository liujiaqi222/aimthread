import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";

import * as authSchema from "@/db/auth-schema";
import type { authDb } from "@/db/client";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";
import { initialSocialName } from "@/auth/social-profile";
import { userNameSchema } from "@/shared/schemas/profile";

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";

export function createAimThreadAuth(config: {
  database: typeof authDb;
  origin: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
}) {
  const appOrigin = new URL(config.origin).origin;
  const MCP_RESOURCE = new URL("/mcp", appOrigin).toString();
  return betterAuth({
    appName: "AimThread",
    baseURL: appOrigin,
    secret: config.secret,
    database: drizzleAdapter(config.database, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
    advanced: {
      database: { joins: true },
      // Better Auth otherwise skips URL origin validation under NODE_ENV=test.
      // Keep tests and production on the same callback/CSRF policy.
      disableOriginCheck: false,
    },
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(config.google ? { google: config.google } : {}),
      ...(config.github ? { github: config.github } : {}),
    },
    // Account linking is implicit only after BOTH email addresses are verified.
    // No provider is trusted to bypass its incoming email verification claim.
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    disabledPaths: ["/link-social", "/unlink-account"],
    onAPIError: { errorURL: "/login" },
    session: {
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
      // Verify a short-lived encrypted cookie locally instead of querying Neon
      // for the session and user on every timer command. Revocation is rechecked
      // after at most 30 seconds; sign-out clears this browser's cache immediately.
      cookieCache: {
        enabled: true,
        maxAge: 30,
        strategy: "jwe",
      },
    },
    trustedOrigins: [appOrigin],
    telemetry: { enabled: false },
    // Provider errors may include bearer material. Retain an event level only;
    // never forward upstream payloads or callback details into application logs.
    logger: {
      log(level) {
        if (level === "error" || level === "warn")
          console.warn(
            `[auth:${level}] Authentication request could not complete.`,
          );
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({ data: { ...account, idToken: null } }),
        },
        update: {
          before: async (account) => ({ data: { ...account, idToken: null } }),
        },
      },
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, name: initialSocialName(user.name) },
          }),
        },
        update: {
          before: async (user) => {
            if (user.name === undefined) return;
            const parsed = userNameSchema.safeParse(user.name);
            if (!parsed.success) {
              throw new APIError("BAD_REQUEST", {
                message: parsed.error.issues[0].message,
              });
            }
            return { data: { ...user, name: parsed.data } };
          },
        },
      },
    },
    plugins: [
      // Web requests only need the session. Automatic JWT header generation
      // queries the signing key on every getSession, even on a cookie-cache hit.
      // MCP/OAuth still use the JWT plugin's explicit signing and JWKS endpoints.
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        resource: MCP_RESOURCE,
        scopes: ["offline_access", MCP_READ_SCOPE, MCP_WRITE_SCOPE],
        resources: [
          {
            identifier: MCP_RESOURCE,
            allowedScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
            accessTokenTtl: 60 * 60,
          },
        ],
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
        isMetadataDocumentUrlAllowed(clientIdUrl) {
          return new URL(clientIdUrl).hostname === "chatgpt.com";
        },
      }),
      // Required for auth.api calls made from Next.js Server Actions.
      nextCookies(),
    ],
  });
}
