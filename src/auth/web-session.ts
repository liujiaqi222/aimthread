import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/auth";
import type { AuthenticatedContext } from "@/auth/context";

export async function readWebSession(): Promise<AuthenticatedContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id || session.session.userId !== session.user.id)
    return null;
  return { userId: session.user.id, actor: "web" };
}

export async function requireWebSession(): Promise<AuthenticatedContext> {
  const context = await readWebSession();
  if (!context) redirect("/login");
  return context;
}
