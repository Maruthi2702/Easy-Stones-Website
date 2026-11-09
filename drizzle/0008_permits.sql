CREATE TABLE "permit_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"month" text NOT NULL,
	"method" text DEFAULT 'report' NOT NULL,
	"filled" integer DEFAULT 0 NOT NULL,
	"added_from_report" text[] DEFAULT '{}'::text[] NOT NULL,
	"report_title" text DEFAULT '' NOT NULL,
	"report_url" text DEFAULT '' NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"in_report" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"missing_from_app" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_in_report" text[] DEFAULT '{}'::text[] NOT NULL,
	"in_search" integer DEFAULT 0 NOT NULL,
	"not_found_again" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_in_county_search" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_issued_yet" text[] DEFAULT '{}'::text[] NOT NULL,
	"dates_moved" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_public" text[] DEFAULT '{}'::text[] NOT NULL,
	"ok" boolean DEFAULT false NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	CONSTRAINT "permit_checks_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "permit_checks_method" CHECK ("method" in ('report', 'search'))
);
--> statement-breakpoint
CREATE TABLE "permit_contacts" (
	"permit_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"license" text,
	CONSTRAINT "permit_contacts_permit_id_position_pk" PRIMARY KEY("permit_id","position")
);
--> statement-breakpoint
CREATE TABLE "permit_contractor_names" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"license" text DEFAULT '' NOT NULL,
	"candidates" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "permit_contractor_names_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "permit_contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"license" text NOT NULL,
	"business_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"license_type" text DEFAULT '' NOT NULL,
	"specialty" text DEFAULT '' NOT NULL,
	"specialty2" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"expires_on" date,
	"principal" text DEFAULT '' NOT NULL,
	"ubi" text DEFAULT '' NOT NULL,
	"not_found" boolean DEFAULT false NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "permit_contractors_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "permit_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"since" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT false NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"seen" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"detail_errors" integer DEFAULT 0 NOT NULL,
	"latest_issued_on" date,
	"unsorted_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "permit_runs_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "permit_runs_kind" CHECK ("kind" in ('backfill', 'daily', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "permits" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"permit_number" text NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"subtype" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"applied_on" date,
	"issued_on" date,
	"finaled_on" date,
	"expires_on" date,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"parcel" text DEFAULT '' NOT NULL,
	"project_name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"valuation" numeric,
	"sqft" numeric,
	"units" numeric,
	"details_at" timestamp with time zone,
	"source_url" text DEFAULT '' NOT NULL,
	"final_only" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "permits_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "permit_contacts" ADD CONSTRAINT "permit_contacts_permit_id_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permit_checks_source_month_key" ON "permit_checks" USING btree ("source","month");--> statement-breakpoint
CREATE INDEX "permit_contacts_license_idx" ON "permit_contacts" USING btree ("license");--> statement-breakpoint
CREATE UNIQUE INDEX "permit_contractor_names_name_key" ON "permit_contractor_names" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "permit_contractors_license_key" ON "permit_contractors" USING btree ("license");--> statement-breakpoint
CREATE INDEX "permit_runs_source_started_idx" ON "permit_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permits_source_number_key" ON "permits" USING btree ("source","permit_number");--> statement-breakpoint
CREATE INDEX "permits_issued_idx" ON "permits" USING btree ("issued_on","permit_number");--> statement-breakpoint
CREATE INDEX "permits_category_issued_idx" ON "permits" USING btree ("category","issued_on");