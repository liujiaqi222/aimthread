import { redirect } from "next/navigation";

import { readWebSession } from "@/auth/web-session";
import { AppShell } from "@/components/app-shell";
import { settingsService } from "@/services";

// This segment is cookie-authenticated and reads live DB state on every
// request; never prerender it against the deployment database.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await readWebSession())) redirect("/login");
  const settings = await settingsService.get({ actor: "web" });
  if (!settings.setupCompletedAt) redirect("/setup");
  return <AppShell>{children}</AppShell>;
}
