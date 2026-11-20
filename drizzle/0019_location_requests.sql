CREATE TABLE "location_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"target_user_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_by_name" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" real,
	"consent_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "location_requests_target_time_idx" ON "location_requests" USING btree ("target_user_id","requested_at");--> statement-breakpoint
CREATE INDEX "location_requests_time_idx" ON "location_requests" USING btree ("requested_at");