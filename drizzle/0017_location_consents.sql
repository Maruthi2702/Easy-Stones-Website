CREATE TABLE "location_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "location_consents_user_version_uq" ON "location_consents" USING btree ("user_id","version");