CREATE TABLE "daily_report_containers" (
	"report_id" text NOT NULL,
	"position" integer NOT NULL,
	"po_number" text DEFAULT '' NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"slabs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_report_containers_report_id_position_pk" PRIMARY KEY("report_id","position")
);
--> statement-breakpoint
CREATE TABLE "daily_report_log" (
	"report_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"earlier" boolean,
	CONSTRAINT "daily_report_log_report_id_position_pk" PRIMARY KEY("report_id","position")
);
--> statement-breakpoint
CREATE TABLE "daily_report_transfers" (
	"report_id" text NOT NULL,
	"position" integer NOT NULL,
	"from_to" text DEFAULT '' NOT NULL,
	"transfer_number" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"slabs" integer DEFAULT 0 NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"direction" text,
	"received" boolean,
	"received_at" timestamp with time zone,
	"received_by" text DEFAULT '' NOT NULL,
	"ticket_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"added_after_submit_at" timestamp with time zone,
	CONSTRAINT "daily_report_transfers_report_id_position_pk" PRIMARY KEY("report_id","position"),
	CONSTRAINT "daily_report_transfers_direction" CHECK ("direction" in ('out', 'in'))
);
--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"location_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visitors_homeowners" integer DEFAULT 0 NOT NULL,
	"visitors_fabricators" integer,
	"visitors_designers" integer,
	"deliveries_assigned" integer DEFAULT 0 NOT NULL,
	"deliveries_capacity" integer,
	"pickups_assigned" integer DEFAULT 0 NOT NULL,
	"pickups_capacity" integer,
	"returns" integer,
	"returns_slabs" integer,
	"sinks" integer,
	"payment_ach_count" integer,
	"payment_ach_amount" numeric,
	"payment_cash_count" integer,
	"payment_cash_amount" numeric,
	"payment_card_count" integer,
	"payment_card_amount" numeric,
	"payment_check_count" integer,
	"payment_check_amount" numeric,
	"payment_return_count" integer,
	"payment_return_amount" numeric,
	"notes" text DEFAULT '' NOT NULL,
	"submitted_by" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"auto_submitted" boolean DEFAULT false NOT NULL,
	"reopened_by" text DEFAULT '' NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "daily_reports_status" CHECK ("status" in ('draft', 'submitted', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"customer_id" text,
	"customer_name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"sales_rep_name" text DEFAULT '' NOT NULL,
	"truck_key" text DEFAULT '' NOT NULL,
	"day" date,
	"time" text DEFAULT '09:00 AM' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"so_number" text DEFAULT '' NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"route_number" integer DEFAULT 1 NOT NULL,
	"location_id" text,
	"driver" text DEFAULT '' NOT NULL,
	"delivery_type" text DEFAULT 'jobsite' NOT NULL,
	"customer_drop_off" boolean DEFAULT false NOT NULL,
	"transfer_destination_id" text,
	"expected_arrival_day" date,
	"received_at" timestamp with time zone,
	"received_by" text DEFAULT '' NOT NULL,
	"arrival_logged_by_name" text,
	"arrival_logged_by_location" text,
	"arrival_logged_at" timestamp with time zone,
	"pickup_info" text DEFAULT '' NOT NULL,
	"carrier_name" text DEFAULT '' NOT NULL,
	"pro_number" text DEFAULT '' NOT NULL,
	"freight_fee" numeric DEFAULT '0' NOT NULL,
	"number_of_slabs" integer DEFAULT 0 NOT NULL,
	"packing_list_url" text DEFAULT '' NOT NULL,
	"packing_list_filename" text DEFAULT '' NOT NULL,
	"packing_list_public_id" text DEFAULT '' NOT NULL,
	"pod_signee_name" text DEFAULT '' NOT NULL,
	"pod_driver_name" text DEFAULT '' NOT NULL,
	"pod_customer_signature" text DEFAULT '' NOT NULL,
	"pod_driver_signature" text DEFAULT '' NOT NULL,
	"pod_customer_signed_at" timestamp with time zone,
	"pod_driver_signed_at" timestamp with time zone,
	"pod_signed_at" timestamp with time zone,
	"pod_photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"pod_notes" text DEFAULT '' NOT NULL,
	"pod_signed_pdf_url" text DEFAULT '' NOT NULL,
	"pod_signed_pdf_filename" text DEFAULT '' NOT NULL,
	"pod_signed_pdf_public_id" text DEFAULT '' NOT NULL,
	"pod_verified" boolean DEFAULT false NOT NULL,
	"pod_cleared_at" timestamp with time zone,
	"pod_cleared_by" text DEFAULT '' NOT NULL,
	"pod_clear_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "deliveries_status" CHECK ("status" in ('pending', 'scheduled', 'completed', 'delayed', 'cancelled')),
	CONSTRAINT "deliveries_delivery_type" CHECK ("delivery_type" in ('jobsite', 'transfer', 'will_call', 'return'))
);
--> statement-breakpoint
CREATE TABLE "payment_history" (
	"payment_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"changes" text DEFAULT '' NOT NULL,
	CONSTRAINT "payment_history_payment_id_position_pk" PRIMARY KEY("payment_id","position"),
	CONSTRAINT "payment_history_action" CHECK ("action" in ('added', 'edited', 'voided'))
);
--> statement-breakpoint
CREATE TABLE "payments_received" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"day" date NOT NULL,
	"customer_id" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"method" text NOT NULL,
	"cents" bigint NOT NULL,
	"invoice" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"entered_by" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text DEFAULT '' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_received_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "payments_received_method" CHECK ("method" in ('ach', 'cash', 'card', 'check', 'return'))
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" text PRIMARY KEY NOT NULL,
	"truck_key" text NOT NULL,
	"name" text NOT NULL,
	"driver" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#D4AF37' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "daily_report_containers" ADD CONSTRAINT "daily_report_containers_report_id_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_log" ADD CONSTRAINT "daily_report_log_report_id_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_transfers" ADD CONSTRAINT "daily_report_transfers_report_id_daily_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_transfer_destination_id_locations_id_fk" FOREIGN KEY ("transfer_destination_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_payment_id_payments_received_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments_received"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_location_day_key" ON "daily_reports" USING btree ("location_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_ticket_id_key" ON "deliveries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "deliveries_location_day_idx" ON "deliveries" USING btree ("location_id","day");--> statement-breakpoint
CREATE INDEX "deliveries_customer_idx" ON "deliveries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "deliveries_truck_day_idx" ON "deliveries" USING btree ("truck_key","day");--> statement-breakpoint
CREATE INDEX "deliveries_transfer_destination_idx" ON "deliveries" USING btree ("transfer_destination_id");--> statement-breakpoint
CREATE INDEX "payments_received_location_day_idx" ON "payments_received" USING btree ("location_id","day");--> statement-breakpoint
CREATE INDEX "payments_received_customer_idx" ON "payments_received" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_truck_key_key" ON "trucks" USING btree ("truck_key");