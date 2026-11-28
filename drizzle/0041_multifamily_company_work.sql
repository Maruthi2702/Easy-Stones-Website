CREATE TABLE "project_lead_company_work" (
	"company_key" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"assigned_to_id" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status_by" text DEFAULT '' NOT NULL,
	"status_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_lead_company_work_status_idx" ON "project_lead_company_work" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_lead_company_work_assigned_idx" ON "project_lead_company_work" USING btree ("assigned_to");