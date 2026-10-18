ALTER TABLE "tasks" ADD COLUMN "initial_estimated_minutes" integer;--> statement-breakpoint
-- Historical estimates before this migration cannot be reconstructed.
UPDATE "tasks" SET "initial_estimated_minutes" = "estimated_minutes" WHERE "estimated_minutes" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initial_estimated_minutes_positive" CHECK ("tasks"."initial_estimated_minutes" is null or "tasks"."initial_estimated_minutes" > 0);
