import { ownedBy } from "@/services/ownership";

import { requireUserId, type AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { appSettings, type AppSettings } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  updateSettingsSchema,
  type UpdateSettingsInput,
} from "@/shared/schemas/settings";

export interface SettingsService {
  get(context: AuthenticatedContext): Promise<AppSettings>;
  update(
    context: AuthenticatedContext,
    input: UpdateSettingsInput,
    options?: { completeSetup?: boolean },
  ): Promise<AppSettings>;
  checkSchema(context: AuthenticatedContext): Promise<void>;
}

export function createSettingsService(database: Database): SettingsService {
  async function ensureSettings(context: AuthenticatedContext): Promise<void> {
    await database
      .insert(appSettings)
      .values({
        userId: requireUserId(context),
        timezone: "UTC",
        weekStartsOn: 1,
        timerMode: "pomodoro",
      })
      .onConflictDoNothing({ target: appSettings.userId });
  }

  async function getSettings(
    context: AuthenticatedContext,
  ): Promise<AppSettings> {
    // Fast path: one round trip when the row already exists (the common
    // case). Only fall back to the idempotent insert when it is missing.
    const [settings] = await database
      .select()
      .from(appSettings)
      .where(ownedBy(context, appSettings))
      .limit(1);
    if (settings) return settings;

    await ensureSettings(context);
    const [created] = await database
      .select()
      .from(appSettings)
      .where(ownedBy(context, appSettings))
      .limit(1);

    if (!created) {
      throw new DomainError(
        "SCHEMA_NOT_READY",
        "App settings could not be initialized. Run database migrations.",
      );
    }
    return created;
  }

  return {
    async get(context) {
      requireUserId(context);
      return getSettings(context);
    },
    async update(context, input, options) {
      const validated = updateSettingsSchema.safeParse(input);
      if (!validated.success) {
        throw new DomainError("INVALID_SETTINGS", "Settings are invalid.", {
          field: validated.error.issues[0]?.path.join(".") || "settings",
        });
      }

      const current = await getSettings(context);
      const [settings] = await database
        .update(appSettings)
        .set({
          ...validated.data,
          ...(options?.completeSetup && {
            setupCompletedAt: current.setupCompletedAt ?? new Date(),
          }),
          updatedAt: new Date(),
        })
        .where(ownedBy(context, appSettings))
        .returning();

      if (!settings) {
        throw new DomainError(
          "SCHEMA_NOT_READY",
          "App settings are unavailable.",
        );
      }
      return settings;
    },
    async checkSchema(context) {
      requireUserId(context);
      try {
        await getSettings(context);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError(
          "SCHEMA_NOT_READY",
          "Database is reachable, but the AimThread schema is missing. Run migrations.",
        );
      }
    },
  };
}
