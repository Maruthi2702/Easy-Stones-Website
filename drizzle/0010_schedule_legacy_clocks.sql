ALTER TABLE "schedules" ADD COLUMN "legacy_start_time" jsonb;
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "legacy_end_time" jsonb;
