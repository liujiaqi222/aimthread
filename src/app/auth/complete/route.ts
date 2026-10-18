import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth/auth";
import { safeReturnPath } from "@/auth/secrets";
import { env } from "@/env";
import { settingsService } from "@/services";

export async function GET(request: NextRequest) {
  const next = safeReturnPath(request.nextUrl.searchParams.get("next"));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const login = new URL("/login", env.BETTER_AUTH_URL);
    login.searchParams.set("next", next);
    login.searchParams.set("error", "session_missing");
    return NextResponse.redirect(login);
  }
  const settings = await settingsService.get({
    userId: session.user.id,
    actor: "web",
  });
  return NextResponse.redirect(
    new URL(settings.setupCompletedAt ? next : "/setup", env.BETTER_AUTH_URL),
  );
}
