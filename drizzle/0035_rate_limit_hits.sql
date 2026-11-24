CREATE TABLE "rate_limit_hits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"resets_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hits_resets_idx" ON "rate_limit_hits" USING btree ("resets_at");