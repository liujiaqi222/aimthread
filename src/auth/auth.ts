import "server-only";

import { createAimThreadAuth } from "@/auth/create-auth";
import { authDb } from "@/db/client";
import { env } from "@/env";

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";
export const MCP_RESOURCE = new URL("/mcp", env.BETTER_AUTH_URL).toString();

export const auth = createAimThreadAuth({
  database: authDb,
  origin: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        }
      : undefined,
  github:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        }
      : undefined,
});
