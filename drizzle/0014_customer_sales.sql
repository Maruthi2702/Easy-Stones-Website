CREATE TABLE "customer_sales_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"exported_on" text DEFAULT '' NOT NULL,
	"customers" integer NOT NULL,
	"total_cents" double precision NOT NULL,
	"unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"imported_by" text DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sales_monthly" (
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"sps_key" text NOT NULL,
	"customer_name" text NOT NULL,
	"cents" double precision NOT NULL,
	"primary_rep" text DEFAULT '' NOT NULL,
	"secondary_rep" text DEFAULT '' NOT NULL,
	"import_id" text NOT NULL,
	CONSTRAINT "customer_sales_monthly_year_month_sps_key_pk" PRIMARY KEY("year","month","sps_key"),
	CONSTRAINT "customer_sales_monthly_month" CHECK ("customer_sales_monthly"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE INDEX "customer_sales_monthly_key_idx" ON "customer_sales_monthly" USING btree ("sps_key");