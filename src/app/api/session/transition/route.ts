import { isSameOriginRequest } from "@/auth/same-origin";
import { z } from "zod";

import { readWebSession } from "@/auth/web-session";
import { sessionContract } from "@/adapters/session-contract";
import { sessionService } from "@/services";
import { sessionPauseSchema } from "@/shared/schemas/session";

const inputSchema = sessionPauseSchema
  .extend({ operation: z.enum(["pause", "resume", "cancel"]) })
  .strict();

// Timer controls must not wait in the client's Server Action queue for autosave or reads.
export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return Response.json({ ok: false }, { status: 403 });
  const authorizationStarted = performance.now();
  const context = await readWebSession();
  if (!context) return Response.json({ ok: false }, { status: 401 });
  const authorizationMs = performance.now() - authorizationStarted;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const mutationStarted = performance.now();
  const result = await sessionContract(() =>
    input.data.operation === "pause"
      ? sessionService.pauseSession(context, input.data.id)
      : input.data.operation === "resume"
        ? sessionService.resumeSession(context, input.data.id)
        : sessionService.cancelSession(context, input.data.id),
  );
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `auth;dur=${authorizationMs.toFixed(1)}, mutation;dur=${(performance.now() - mutationStarted).toFixed(1)}`,
    },
  });
}
