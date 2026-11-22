CREATE TABLE "location_device_health" (
	"user_id" text PRIMARY KEY NOT NULL,
	"permission" text DEFAULT 'unknown' NOT NULL,
	"low_power" boolean DEFAULT false NOT NULL,
	"battery_pct" integer,
	"charging" boolean DEFAULT false NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_latest" (
	"user_id" text PRIMARY KEY NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_view_log" (
	"id" text PRIMARY KEY NOT NULL,
	"viewer_id" text NOT NULL,
	"viewer_name" text DEFAULT '' NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"day" text DEFAULT '' NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "location_latest_updated_idx" ON "location_latest" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "location_view_log_subject_time_idx" ON "location_view_log" USING btree ("subject_id","viewed_at");--> statement-breakpoint
CREATE INDEX "location_view_log_viewer_time_idx" ON "location_view_log" USING btree ("viewer_id","viewed_at");--> statement-breakpoint
CREATE INDEX "location_view_log_time_idx" ON "location_view_log" USING btree ("viewed_at");--> statement-breakpoint
INSERT INTO "location_latest" ("user_id","branch","recorded_at","lat","lng","accuracy_m","updated_at")
SELECT DISTINCT ON ("user_id") "user_id","branch","recorded_at","lat","lng","accuracy_m", "recorded_at"
FROM "location_points" ORDER BY "user_id", "recorded_at" DESC
ON CONFLICT ("user_id") DO NOTHING;
