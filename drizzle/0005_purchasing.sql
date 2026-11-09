CREATE TABLE "purchasing_draft_history" (
	"draft_id" text NOT NULL,
	"position" integer NOT NULL,
	"action" text,
	"at" timestamp with time zone,
	"name" text,
	"note" text,
	CONSTRAINT "purchasing_draft_history_draft_id_position_pk" PRIMARY KEY("draft_id","position")
);
--> statement-breakpoint
CREATE TABLE "purchasing_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"fingerprint" text,
	"input_snapshot" jsonb,
	"lines" jsonb NOT NULL,
	"loads" jsonb NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_by_name" text,
	"existing_po_lines" text[] DEFAULT '{}'::text[] NOT NULL,
	"existing_transit_parents" text[] DEFAULT '{}'::text[] NOT NULL,
	"linked_po_lines" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchasing_drafts_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "purchasing_drafts_status" CHECK ("status" in ('draft', 'approved', 'ordered', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "purchasing_inbound" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_id" text NOT NULL,
	"complete" boolean,
	"branches" text[],
	"imported_by" text,
	"rows" jsonb NOT NULL,
	"receipts" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchasing_inbound_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "purchasing_locks" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"scope_id" text
);
--> statement-breakpoint
CREATE TABLE "purchasing_po_links" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchasing_scope_aliases" (
	"scope_id" text NOT NULL,
	"position" integer NOT NULL,
	"sales_product" text,
	"stock_product" text,
	CONSTRAINT "purchasing_scope_aliases_scope_id_position_pk" PRIMARY KEY("scope_id","position")
);
--> statement-breakpoint
CREATE TABLE "purchasing_scope_policies" (
	"scope_id" text NOT NULL,
	"position" integer NOT NULL,
	"product" text,
	"supplier" text,
	"bundle_slabs" numeric,
	"minimum_slabs" numeric,
	"sf_per_slab" numeric,
	"weight_kg" numeric,
	"mix_group" text,
	"active" boolean,
	CONSTRAINT "purchasing_scope_policies_scope_id_position_pk" PRIMARY KEY("scope_id","position")
);
--> statement-breakpoint
CREATE TABLE "purchasing_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"branches" text[] DEFAULT '{}'::text[] NOT NULL,
	"cohort_id" text,
	"cohort_revision" text,
	"observed_through" date,
	"sales_coverage_cohort_id" text,
	"sales_coverage_through" date,
	"sales_coverage_confirmed_at" timestamp with time zone,
	"sales_coverage_confirmed_by_id" text,
	"sales_coverage_confirmed_by_name" text,
	"sales_coverage_source" text,
	"full_sales_coverage" boolean,
	"stock_snapshot_id" text,
	"stock_coverage_confirmed" boolean,
	"free_stock_validated" boolean,
	"policy_confirmed" boolean,
	"review_days" integer DEFAULT 7 NOT NULL,
	"buffer_days" integer DEFAULT 21 NOT NULL,
	"stock_max_hours" integer DEFAULT 24 NOT NULL,
	"sales_max_days" integer DEFAULT 14 NOT NULL,
	"container_payload_kg" numeric,
	"container_tare_kg" numeric,
	"container_max_slabs" integer,
	"container_layout_confirmed" boolean,
	"container_mixing_confirmed" boolean,
	"updated_by" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchasing_scopes_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "purchasing_scopes_sales_coverage_source" CHECK ("sales_coverage_source" in ('scope-form', 'owner-confirmation'))
);
--> statement-breakpoint
ALTER TABLE "purchasing_draft_history" ADD CONSTRAINT "purchasing_draft_history_draft_id_purchasing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."purchasing_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_drafts" ADD CONSTRAINT "purchasing_drafts_scope_id_purchasing_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."purchasing_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_inbound" ADD CONSTRAINT "purchasing_inbound_scope_id_purchasing_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."purchasing_scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_locks" ADD CONSTRAINT "purchasing_locks_draft_id_purchasing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."purchasing_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_po_links" ADD CONSTRAINT "purchasing_po_links_draft_id_purchasing_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."purchasing_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_scope_aliases" ADD CONSTRAINT "purchasing_scope_aliases_scope_id_purchasing_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."purchasing_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing_scope_policies" ADD CONSTRAINT "purchasing_scope_policies_scope_id_purchasing_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."purchasing_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchasing_drafts_scope_idx" ON "purchasing_drafts" USING btree ("scope_id","created_at");--> statement-breakpoint
CREATE INDEX "purchasing_inbound_scope_idx" ON "purchasing_inbound" USING btree ("scope_id","created_at");--> statement-breakpoint
CREATE INDEX "purchasing_locks_draft_idx" ON "purchasing_locks" USING btree ("draft_id");