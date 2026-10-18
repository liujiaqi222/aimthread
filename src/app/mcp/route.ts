import { eq } from "drizzle-orm";
import { authDb } from "@/db/client";
import { user } from "@/db/auth-schema";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";

import {
  auth,
  MCP_READ_SCOPE,
  MCP_RESOURCE,
  MCP_WRITE_SCOPE,
} from "@/auth/auth";
import { logger } from "@/lib/logger";
import { createAimThreadMcpServer } from "@/mcp/server";
import {
  dashboardService,
  distractionService,
  historyService,
  planningService,
  selectionService,
  sessionService,
  settingsService,
  statisticsService,
  executionReportService,
} from "@/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlerFor(userId: string) {
  return createMcpHandler(
    () =>
      createAimThreadMcpServer(
        {
          settingsService,
          planningService,
          selectionService,
          sessionService,
          distractionService,
          dashboardService,
          historyService,
          statisticsService,
          executionReportService,
        },
        { actor: "mcp", userId },
      ),
    {
      legacy: "reject",
      onerror(error) {
        logger.error("MCP request failed", { error: error.message });
      },
    },
  );
}

export const POST = requireMcpAuth(
  auth,
  async (request, claims) => {
    if (typeof claims.sub !== "string" || !claims.sub.trim())
      return new Response(null, { status: 401 });
    const [subject] = await authDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, claims.sub))
      .limit(1);
    if (!subject) return new Response(null, { status: 401 });
    return handlerFor(subject.id).fetch(request);
  },
  {
    resource: MCP_RESOURCE,
    requiredScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
  },
);
