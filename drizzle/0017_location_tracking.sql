CREATE TABLE "location_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_points" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"client_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" real,
	"speed_mps" real
);
--> statement-breakpoint
CREATE UNIQUE INDEX "location_consents_user_version_uq" ON "location_consents" USING btree ("user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "location_points_user_client_uq" ON "location_points" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "location_points_user_time_idx" ON "location_points" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "location_points_time_idx" ON "location_points" USING btree ("recorded_at");