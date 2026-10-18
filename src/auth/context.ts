import { DomainError } from "@/shared/domain-error";

/** Built only from a verified Web session or MCP token, never request input. */
export interface AuthenticatedContext {
  userId: string;
  actor: "web" | "mcp";
}

export function requireUserId(context: AuthenticatedContext): string {
  if (
    !context ||
    typeof context.userId !== "string" ||
    !context.userId.trim() ||
    (context.actor !== "web" && context.actor !== "mcp")
  ) {
    throw new DomainError("UNAUTHORIZED", "A verified User is required.");
  }
  return context.userId;
}
