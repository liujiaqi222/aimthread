import { redirect } from "next/navigation";

import { MCP_RESOURCE } from "@/auth/auth";
import { readWebSession } from "@/auth/web-session";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { planningService, settingsService } from "@/services";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const context = await readWebSession();
  if (!context) redirect("/login?next=/onboarding");

  const [settings, goals] = await Promise.all([
    settingsService.get(context),
    planningService.listGoals(context, { status: "active", limit: 1 }),
  ]);

  if (!settings.setupCompletedAt) redirect("/setup");
  if (goals.items.length > 0) redirect("/today");

  return <OnboardingFlow endpoint={MCP_RESOURCE} userId={context.userId} />;
}
