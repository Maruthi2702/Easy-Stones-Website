CREATE TABLE "project_lead_import_backups" (
	"import_id" text NOT NULL,
	"project_id" text NOT NULL,
	"previous" jsonb,
	CONSTRAINT "project_lead_import_backups_import_id_project_id_pk" PRIMARY KEY("import_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "project_lead_imports" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_lead_imports" ADD COLUMN "undone_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_lead_import_backups" ADD CONSTRAINT "project_lead_import_backups_import_id_project_lead_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."project_lead_imports"("id") ON DELETE cascade ON UPDATE no action;