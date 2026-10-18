-- This schema transition requires a fresh database. Never claim old data for a default User.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM goals) OR EXISTS (SELECT 1 FROM sessions)
    OR EXISTS (SELECT 1 FROM app_settings) OR EXISTS (SELECT 1 FROM idempotency_records)
    OR EXISTS (SELECT 1 FROM "user") THEN
    RAISE EXCEPTION 'User ownership requires an empty database. No data was changed; provision a fresh database before applying this migration.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_singleton";
--> statement-breakpoint
ALTER TABLE "focus_intervals" DROP CONSTRAINT "focus_intervals_phase_id_session_phases_id_fk";
--> statement-breakpoint
DROP INDEX "goals_status_position_idx";
--> statement-breakpoint
DROP INDEX "sessions_one_running_unique";
--> statement-breakpoint
DROP INDEX "sessions_status_started_idx";
--> statement-breakpoint
DROP INDEX "sessions_started_id_idx";
--> statement-breakpoint
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_operation_key_pk";
--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "id";
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "user_id" text PRIMARY KEY NOT NULL;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_id_user_unique" UNIQUE("id","user_id");
--> statement-breakpoint
ALTER TABLE "session_phases" ADD CONSTRAINT "session_phases_id_session_unique" UNIQUE("id","session_id");
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_goal_user_fk" FOREIGN KEY ("selected_goal_id","user_id") REFERENCES "public"."goals"("id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "focus_intervals" ADD CONSTRAINT "focus_intervals_phase_session_fk" FOREIGN KEY ("phase_id","session_id") REFERENCES "public"."session_phases"("id","session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_phases" ADD CONSTRAINT "session_phases_next_session_fk" FOREIGN KEY ("next_phase_id","session_id") REFERENCES "public"."session_phases"("id","session_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_goal_user_fk" FOREIGN KEY ("goal_id","user_id") REFERENCES "public"."goals"("id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "goals_status_position_idx" ON "goals" USING btree ("user_id","status","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_running_unique" ON "sessions" USING btree ("user_id") WHERE "sessions"."status" in ('active', 'paused');
--> statement-breakpoint
CREATE INDEX "sessions_status_started_idx" ON "sessions" USING btree ("user_id","status","started_at");
--> statement-breakpoint
CREATE INDEX "sessions_started_id_idx" ON "sessions" USING btree ("user_id","started_at","id");
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_operation_key_pk" PRIMARY KEY("user_id","operation","key");
