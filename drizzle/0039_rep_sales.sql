CREATE TABLE "rep_sales_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"exported_on" text DEFAULT '' NOT NULL,
	"reps" integer NOT NULL,
	"total_cents" double precision NOT NULL,
	"no_rep_cents" double precision DEFAULT 0 NOT NULL,
	"imported_by" text DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_sales_links" (
	"rep_key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rep_name" text DEFAULT '' NOT NULL,
	"linked_by" text DEFAULT '' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rep_sales_monthly" (
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"rep_key" text NOT NULL,
	"rep_name" text NOT NULL,
	"cents" double precision NOT NULL,
	"import_id" text NOT NULL,
	CONSTRAINT "rep_sales_monthly_year_month_rep_key_pk" PRIMARY KEY("year","month","rep_key"),
	CONSTRAINT "rep_sales_monthly_month" CHECK ("rep_sales_monthly"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE INDEX "rep_sales_monthly_year_idx" ON "rep_sales_monthly" USING btree ("year");