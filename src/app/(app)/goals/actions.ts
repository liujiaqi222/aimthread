"use server";

import { readWebSession } from "@/auth/web-session";
import { executionReportService } from "@/services";
import { planningContract } from "@/adapters/planning-contract";

export async function getGoalContextAction(goalId: string) {
  const context = await readWebSession();
  if (!context) return { ok: false as const };
  return planningContract(() =>
    executionReportService.getGoalContext(context, { goalId }),
  );
}
