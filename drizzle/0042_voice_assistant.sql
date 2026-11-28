CREATE TABLE "assistant_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "voice_words" (
	"id" text PRIMARY KEY NOT NULL,
	"heard" text DEFAULT '' NOT NULL,
	"meant" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_words_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "voice_words_kind" CHECK ("kind" in ('stone', 'brand', 'branch', 'business', 'slang', 'customer', 'other'))
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "by_voice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_usage_day_idx" ON "assistant_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_words_heard_uq" ON "voice_words" USING btree (lower("heard")) WHERE "voice_words"."heard" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "voice_words_plain_uq" ON "voice_words" USING btree (lower("meant")) WHERE "voice_words"."heard" = '';