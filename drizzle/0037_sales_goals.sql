CREATE TABLE "sales_goals" (
	"user_id" text NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"cents" double precision NOT NULL,
	"set_by" text DEFAULT '' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_goals_user_id_year_month_pk" PRIMARY KEY("user_id","year","month"),
	CONSTRAINT "sales_goals_month" CHECK ("sales_goals"."month" between 1 and 12),
	CONSTRAINT "sales_goals_cents" CHECK ("sales_goals"."cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX "sales_goals_year_idx" ON "sales_goals" USING btree ("year");