CREATE TABLE "acct_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"txn_id" text NOT NULL,
	"payment_id" text DEFAULT '' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"by_id" text DEFAULT '' NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "acct_audit_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_audit_entity_type" CHECK ("entity_type" in ('charge', 'invoice', 'carrier'))
);
--> statement-breakpoint
CREATE TABLE "acct_carrier_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"carrier_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" date,
	"total_cents" bigint NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" text DEFAULT '' NOT NULL,
	"approved_by_name" text DEFAULT '' NOT NULL,
	"payment_id" text DEFAULT '' NOT NULL,
	"paid_on" date,
	"payment_method" text DEFAULT '' NOT NULL,
	"payment_reference" text DEFAULT '' NOT NULL,
	"payment_recorded_at" timestamp with time zone,
	"payment_recorded_by_id" text DEFAULT '' NOT NULL,
	"payment_recorded_by_name" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" text DEFAULT '' NOT NULL,
	"voided_by_name" text DEFAULT '' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"updated_by_id" text DEFAULT '' NOT NULL,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_carrier_invoices_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_carrier_invoices_status" CHECK ("status" in ('draft', 'approved', 'paid', 'void'))
);
--> statement-breakpoint
CREATE TABLE "acct_carriers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"payment_terms" text DEFAULT 'per_delivery' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"updated_by_id" text DEFAULT '' NOT NULL,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_carriers_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_carriers_payment_terms" CHECK ("payment_terms" in ('per_delivery', 'per_invoice'))
);
--> statement-breakpoint
CREATE TABLE "acct_freight_charge_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"charge_id" text NOT NULL,
	"position" integer NOT NULL,
	"code" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" text DEFAULT '' NOT NULL,
	"resolved_by_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "acct_freight_charge_flags_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_freight_charge_flags_code" CHECK ("code" in ('delivery_reopened', 'delivery_changed'))
);
--> statement-breakpoint
CREATE TABLE "acct_freight_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"delivery_ticket_id" text,
	"so_number" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"delivery_day" date,
	"location_id" text,
	"carrier_id" text,
	"carrier_name_raw" text DEFAULT '' NOT NULL,
	"bol_number" text DEFAULT '' NOT NULL,
	"amount_cents" bigint,
	"description" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_id" text,
	"source_so_number" text,
	"source_customer_name" text,
	"source_delivery_date" text,
	"source_location" text,
	"source_carrier_name_raw" text,
	"source_bol_number" text,
	"source_amount_cents" bigint,
	"hand_set" text[] DEFAULT '{}'::text[] NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" text DEFAULT '' NOT NULL,
	"approved_by_name" text DEFAULT '' NOT NULL,
	"payment_id" text DEFAULT '' NOT NULL,
	"paid_on" date,
	"payment_method" text DEFAULT '' NOT NULL,
	"payment_reference" text DEFAULT '' NOT NULL,
	"payment_recorded_at" timestamp with time zone,
	"payment_recorded_by_id" text DEFAULT '' NOT NULL,
	"payment_recorded_by_name" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" text DEFAULT '' NOT NULL,
	"voided_by_name" text DEFAULT '' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"updated_by_id" text DEFAULT '' NOT NULL,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acct_freight_charges_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_freight_charges_source" CHECK ("source" in ('delivery', 'manual')),
	CONSTRAINT "acct_freight_charges_status" CHECK ("status" in ('draft', 'approved', 'paid', 'void'))
);
--> statement-breakpoint
CREATE TABLE "acct_invoice_charges" (
	"invoice_id" text NOT NULL,
	"position" integer NOT NULL,
	"charge_id" text NOT NULL,
	CONSTRAINT "acct_invoice_charges_invoice_id_position_pk" PRIMARY KEY("invoice_id","position")
);
--> statement-breakpoint
CREATE TABLE "acct_payment_charges" (
	"payment_row_id" text NOT NULL,
	"position" integer NOT NULL,
	"charge_id" text NOT NULL,
	CONSTRAINT "acct_payment_charges_payment_row_id_position_pk" PRIMARY KEY("payment_row_id","position")
);
--> statement-breakpoint
CREATE TABLE "acct_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"request_id" text,
	"kind" text NOT NULL,
	"carrier_id" text,
	"invoice_id" text,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"total_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"approved_in_same_step" boolean DEFAULT false NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by_id" text DEFAULT '' NOT NULL,
	"recorded_by_name" text DEFAULT '' NOT NULL,
	CONSTRAINT "acct_payments_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_payments_kind" CHECK ("kind" in ('charges', 'invoice')),
	CONSTRAINT "acct_payments_method" CHECK ("method" in ('check', 'ach', 'card', 'cash', 'other'))
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_assignment_allocations" (
	"assignment_id" text NOT NULL,
	"position" integer NOT NULL,
	"location" text,
	"basis_points" integer,
	CONSTRAINT "acct_fuelman_assignment_allocations_assignment_id_position_pk" PRIMARY KEY("assignment_id","position")
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"external_id" text NOT NULL,
	"reported_name" text,
	"driver_key" text,
	"driver_name" text,
	"from_day" date,
	"to_day" date,
	"updated_by_id" text,
	"updated_by_name" text,
	"updated_at" timestamp with time zone,
	CONSTRAINT "acct_fuelman_assignments_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"month" text,
	"scope_key" text,
	"external_id" text,
	"driver_key" text,
	"driver_name" text,
	"location" text,
	"category" text,
	"amount_cents" bigint,
	"source_line" integer,
	"day" date,
	CONSTRAINT "acct_fuelman_expenses_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_history" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text,
	"scope_key" text,
	"action" text,
	"at" timestamp with time zone,
	"actor_id" text,
	"actor_name" text,
	"note" text,
	"detail" jsonb,
	CONSTRAINT "acct_fuelman_history_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_key" text,
	"month" text,
	"published_report_id" text,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_by_id" text,
	"closed_by_name" text,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_by_id" text,
	"created_by_name" text,
	CONSTRAINT "acct_fuelman_profiles_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_fuelman_profiles_kind" CHECK ("kind" in ('driver', 'shared'))
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_key" text NOT NULL,
	"file_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"period_key" text NOT NULL,
	"filename" text,
	"parsed" jsonb,
	"revision" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"dispositions" jsonb NOT NULL,
	"overrides" jsonb NOT NULL,
	"imported_at" timestamp with time zone,
	"imported_by_id" text,
	"imported_by_name" text,
	"frozen_review" jsonb,
	"published_at" timestamp with time zone,
	"note" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "acct_fuelman_reports_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "acct_fuelman_reports_status" CHECK ("status" in ('draft', 'posted', 'superseded', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"pdf" "bytea" NOT NULL,
	CONSTRAINT "acct_fuelman_sources_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "acct_fuelman_state" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acct_carrier_invoices" ADD CONSTRAINT "acct_carrier_invoices_carrier_id_acct_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."acct_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_freight_charge_flags" ADD CONSTRAINT "acct_freight_charge_flags_charge_id_acct_freight_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."acct_freight_charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_freight_charges" ADD CONSTRAINT "acct_freight_charges_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_freight_charges" ADD CONSTRAINT "acct_freight_charges_carrier_id_acct_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."acct_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_freight_charges" ADD CONSTRAINT "acct_freight_charges_invoice_id_acct_carrier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."acct_carrier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_invoice_charges" ADD CONSTRAINT "acct_invoice_charges_invoice_id_acct_carrier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."acct_carrier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_invoice_charges" ADD CONSTRAINT "acct_invoice_charges_charge_id_acct_freight_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."acct_freight_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_payment_charges" ADD CONSTRAINT "acct_payment_charges_payment_row_id_acct_payments_id_fk" FOREIGN KEY ("payment_row_id") REFERENCES "public"."acct_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_payment_charges" ADD CONSTRAINT "acct_payment_charges_charge_id_acct_freight_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."acct_freight_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_payments" ADD CONSTRAINT "acct_payments_carrier_id_acct_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."acct_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_payments" ADD CONSTRAINT "acct_payments_invoice_id_acct_carrier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."acct_carrier_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_fuelman_assignment_allocations" ADD CONSTRAINT "acct_fuelman_assignment_allocations_assignment_id_acct_fuelman_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."acct_fuelman_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_fuelman_expenses" ADD CONSTRAINT "acct_fuelman_expenses_report_id_acct_fuelman_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."acct_fuelman_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_fuelman_periods" ADD CONSTRAINT "acct_fuelman_periods_published_report_id_acct_fuelman_reports_id_fk" FOREIGN KEY ("published_report_id") REFERENCES "public"."acct_fuelman_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acct_fuelman_sources" ADD CONSTRAINT "acct_fuelman_sources_report_id_acct_fuelman_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."acct_fuelman_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acct_audit_txn_key" ON "acct_audit" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "acct_audit_entity_idx" ON "acct_audit" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "acct_audit_payment_idx" ON "acct_audit" USING btree ("payment_id") WHERE payment_id > '';--> statement-breakpoint
CREATE UNIQUE INDEX "acct_carrier_invoices_number_key" ON "acct_carrier_invoices" USING btree ("carrier_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_carriers_name_key_key" ON "acct_carriers" USING btree ("name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_freight_charges_delivery_key" ON "acct_freight_charges" USING btree ("delivery_ticket_id") WHERE delivery_ticket_id is not null;--> statement-breakpoint
CREATE INDEX "acct_freight_charges_location_status_idx" ON "acct_freight_charges" USING btree ("location_id","status","delivery_day");--> statement-breakpoint
CREATE INDEX "acct_freight_charges_carrier_idx" ON "acct_freight_charges" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX "acct_freight_charges_invoice_idx" ON "acct_freight_charges" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_payments_payment_id_key" ON "acct_payments" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_payments_request_key" ON "acct_payments" USING btree ("request_id") WHERE request_id is not null;--> statement-breakpoint
CREATE INDEX "acct_payments_paid_on_idx" ON "acct_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_assignments_card_from_key" ON "acct_fuelman_assignments" USING btree ("scope_key","external_id","from_day");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_expenses_line_key" ON "acct_fuelman_expenses" USING btree ("report_id","source_line","location");--> statement-breakpoint
CREATE INDEX "acct_fuelman_expenses_month_location_idx" ON "acct_fuelman_expenses" USING btree ("month","location");--> statement-breakpoint
CREATE INDEX "acct_fuelman_history_report_idx" ON "acct_fuelman_history" USING btree ("report_id","at");--> statement-breakpoint
CREATE INDEX "acct_fuelman_periods_month_idx" ON "acct_fuelman_periods" USING btree ("month","published_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_reports_file_key" ON "acct_fuelman_reports" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_reports_content_key" ON "acct_fuelman_reports" USING btree ("scope_key","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_reports_period_revision_key" ON "acct_fuelman_reports" USING btree ("period_key","revision");--> statement-breakpoint
CREATE INDEX "acct_fuelman_reports_imported_idx" ON "acct_fuelman_reports" USING btree ("imported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "acct_fuelman_sources_report_key" ON "acct_fuelman_sources" USING btree ("report_id");