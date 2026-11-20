CREATE TABLE "project_lead_companies" (
	"project_id" text NOT NULL,
	"position" integer NOT NULL,
	"company_id" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"role_group" text DEFAULT 'other' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	CONSTRAINT "project_lead_companies_project_id_position_pk" PRIMARY KEY("project_id","position")
);
--> statement-breakpoint
CREATE TABLE "project_lead_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"projects" integer NOT NULL,
	"companies" integer NOT NULL,
	"added" integer NOT NULL,
	"updated" integer NOT NULL,
	"imported_by" text DEFAULT '' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"value" numeric,
	"stage" text DEFAULT '' NOT NULL,
	"subcategory" text DEFAULT '' NOT NULL,
	"bid_date" date,
	"listed_on" date,
	"updated_on" date,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"county" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"floors" integer,
	"floor_area" numeric,
	"floor_area_unit" text DEFAULT '' NOT NULL,
	"site_area" numeric,
	"site_area_unit" text DEFAULT '' NOT NULL,
	"stage_note" text DEFAULT '' NOT NULL,
	"units" integer,
	"owner_type" text DEFAULT '' NOT NULL,
	"import_id" text DEFAULT '' NOT NULL,
	"first_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status_by" text DEFAULT '' NOT NULL,
	"status_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_lead_companies" ADD CONSTRAINT "project_lead_companies_project_id_project_leads_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_lead_companies_name_idx" ON "project_lead_companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "project_leads_updated_idx" ON "project_leads" USING btree ("updated_on");--> statement-breakpoint
CREATE INDEX "project_leads_state_idx" ON "project_leads" USING btree ("state","city");--> statement-breakpoint
CREATE INDEX "project_leads_status_idx" ON "project_leads" USING btree ("status");