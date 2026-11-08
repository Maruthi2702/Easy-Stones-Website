CREATE TABLE "location_report_recipients" (
	"location_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "location_report_recipients_location_id_user_id_pk" PRIMARY KEY("location_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_code" text DEFAULT '' NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"rdc" text DEFAULT '' NOT NULL,
	"profit_center" boolean DEFAULT false NOT NULL,
	"warehouse" boolean DEFAULT false NOT NULL,
	"primary_name" text DEFAULT '' NOT NULL,
	"primary_email" text DEFAULT '' NOT NULL,
	"primary_phone" text DEFAULT '' NOT NULL,
	"primary_fax" text DEFAULT '' NOT NULL,
	"primary_website" text DEFAULT '' NOT NULL,
	"street" text DEFAULT '' NOT NULL,
	"suite" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip_code" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"geocode_status" text DEFAULT '' NOT NULL,
	"geocode_precision" text DEFAULT '' NOT NULL,
	"geocode_formatted_address" text DEFAULT '' NOT NULL,
	"geocode_address_key" text DEFAULT '' NOT NULL,
	"geocode_updated_at" timestamp with time zone,
	"geocode_error" text DEFAULT '' NOT NULL,
	"accounting_same_as_primary" boolean DEFAULT true NOT NULL,
	"accounting_name" text DEFAULT '' NOT NULL,
	"accounting_email" text DEFAULT '' NOT NULL,
	"accounting_phone" text DEFAULT '' NOT NULL,
	"accounting_street" text DEFAULT '' NOT NULL,
	"accounting_suite" text DEFAULT '' NOT NULL,
	"accounting_city" text DEFAULT '' NOT NULL,
	"accounting_state" text DEFAULT '' NOT NULL,
	"accounting_zip_code" text DEFAULT '' NOT NULL,
	"default_sales_rep_name" text DEFAULT '' NOT NULL,
	"default_price_level" smallint,
	"payment_terms" text DEFAULT '' NOT NULL,
	"sales_tax_area" text DEFAULT '' NOT NULL,
	"sales_tax_rate" numeric(6, 3),
	"avg_unit_freight" numeric(12, 2),
	"unit_overhead_pct" numeric(6, 2),
	"report_extra_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"delivery_columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited_by" text DEFAULT '' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "locations_default_price_level" CHECK (default_price_level between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "mongo_copy_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_copy_at" timestamp with time zone,
	"last_copy_report" jsonb,
	"locked_at" timestamp with time zone,
	"locked_by" text DEFAULT '' NOT NULL,
	CONSTRAINT "mongo_copy_state_single_row" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "resource_families" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_families_name_key" UNIQUE("name"),
	CONSTRAINT "resource_families_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "resource_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"family" text DEFAULT 'other' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_types_name_key" UNIQUE("name"),
	CONSTRAINT "resource_types_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"seeded_permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"manageable_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"approves_card_receipts_of" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_key" UNIQUE("name"),
	CONSTRAINT "roles_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "user_locations" (
	"user_id" text NOT NULL,
	"location_id" text NOT NULL,
	CONSTRAINT "user_locations_user_id_location_id_pk" PRIMARY KEY("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'sales_rep' NOT NULL,
	"home_location_id" text,
	"all_locations" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by" text DEFAULT '' NOT NULL,
	"joining_date" timestamp with time zone,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"temp_password_expires_at" timestamp with time zone,
	"session_version" integer DEFAULT 0 NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"calendar_feed_key" text,
	"google_access_token" text,
	"google_refresh_token" text,
	"google_email" text,
	"google_calendar_sync_enabled" boolean DEFAULT false NOT NULL,
	"icloud_username" text,
	"icloud_password" text,
	"icloud_calendar_url" text,
	"icloud_calendar_name" text,
	"icloud_sync_enabled" boolean DEFAULT false NOT NULL,
	"route_planner_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned_tabs" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited_by" text DEFAULT '' NOT NULL,
	"edited_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "visit_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"uses_notes" boolean DEFAULT true NOT NULL,
	"uses_outcome" boolean DEFAULT true NOT NULL,
	"follow_up" text DEFAULT 'optional' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_types_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "visit_types_follow_up" CHECK (follow_up in ('none', 'optional', 'always'))
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"customer_id" text,
	"action" text NOT NULL,
	"performed_by" text NOT NULL,
	"performed_by_name" text NOT NULL,
	"performed_by_role" text,
	"details" jsonb,
	"logged_at" timestamp(3),
	CONSTRAINT "activity_logs_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3),
	CONSTRAINT "customer_contacts_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "customer_delete_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer" jsonb NOT NULL,
	"source" text DEFAULT 'bulk' NOT NULL,
	"deleted_by" text DEFAULT '' NOT NULL,
	"sps_keep_deleted" boolean DEFAULT false NOT NULL,
	"sps_keep_run" text DEFAULT '' NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_delete_backups_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "customer_links" (
	"customer_id" text NOT NULL,
	"other_customer_id" text NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "customer_links_customer_id_kind_other_customer_id_pk" PRIMARY KEY("customer_id","kind","other_customer_id"),
	CONSTRAINT "customer_links_kind" CHECK (kind in ('associated', 'not_duplicate')),
	CONSTRAINT "customer_links_not_self" CHECK (customer_id <> other_customer_id)
);
--> statement-breakpoint
CREATE TABLE "customer_logins" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"password_hash" text,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"login_ips" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_merge_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"group" jsonb NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merge_backups_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"marketing_email" text DEFAULT '' NOT NULL,
	"receive_marketing" boolean DEFAULT true NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Onboarded' NOT NULL,
	"customer_type" text,
	"level" text DEFAULT 'Level - 3' NOT NULL,
	"price_level" smallint DEFAULT 1 NOT NULL,
	"location_id" text NOT NULL,
	"sales_rep_id" text,
	"created_by_id" text,
	"street" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"zip_code" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"geocode_status" text DEFAULT 'pending' NOT NULL,
	"geocode_precision" text DEFAULT '' NOT NULL,
	"geocode_formatted_address" text DEFAULT '' NOT NULL,
	"geocode_address_key" text DEFAULT '' NOT NULL,
	"geocode_updated_at" timestamp with time zone,
	"geocode_error" text DEFAULT '' NOT NULL,
	"moda_display" boolean,
	"moda_binders" integer DEFAULT 0 NOT NULL,
	"moda_earlier_display" boolean,
	"moda_earlier_binders" integer,
	"quick_note" text DEFAULT '' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sps_key" text,
	"sps_name" text,
	"sps_code" text,
	"sps_first_imported_at" timestamp with time zone,
	"sps_last_seen_at" timestamp with time zone,
	"sps_connected_at" timestamp with time zone,
	"sps_connected_by" text,
	"sps_reviewed_as" text,
	"sps_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "customers_price_level" CHECK (price_level between 1 and 4),
	CONSTRAINT "customers_moda_binders" CHECK (moda_binders >= 0)
);
--> statement-breakpoint
CREATE TABLE "resource_attachments" (
	"resource_id" text NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "resource_attachments_resource_id_position_pk" PRIMARY KEY("resource_id","position")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"position" integer NOT NULL,
	"placement_visit_id" text,
	"resource_type" text,
	"resource_date" date,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"qty" integer,
	"url" text DEFAULT '' NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp(3),
	CONSTRAINT "resources_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "resources_qty" CHECK (qty between 1 and 999)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"starts_at" timestamp(3) NOT NULL,
	"ends_at" timestamp(3),
	"activity_type" text DEFAULT 'Visit' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	"visit_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "schedules_activity_type" CHECK (activity_type in ('Visit', 'Call', 'Drop-off', 'Other')),
	CONSTRAINT "schedules_status" CHECK (status in ('Scheduled', 'Completed', 'Cancelled')),
	CONSTRAINT "schedules_source" CHECK (source in ('manual', 'route_planner', 'visit_log'))
);
--> statement-breakpoint
CREATE TABLE "visit_attachments" (
	"visit_id" text NOT NULL,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "visit_attachments_visit_id_position_pk" PRIMARY KEY("visit_id","position")
);
--> statement-breakpoint
CREATE TABLE "visit_follow_up_events" (
	"visit_id" text NOT NULL,
	"position" integer NOT NULL,
	"action" text NOT NULL,
	"at" timestamp(3) NOT NULL,
	"on_day" date,
	"by_id" text,
	"by_name" text DEFAULT '' NOT NULL,
	"from_day" date,
	"to_day" date,
	CONSTRAINT "visit_follow_up_events_visit_id_position_pk" PRIMARY KEY("visit_id","position")
);
--> statement-breakpoint
CREATE TABLE "visit_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"visit_id" text NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	"customer_id" text,
	"user_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp(3),
	CONSTRAINT "visit_reactions_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"position" integer NOT NULL,
	"visit_date" date NOT NULL,
	"visit_type" text DEFAULT '' NOT NULL,
	"customer_contact_name" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"manager_comment" text DEFAULT '' NOT NULL,
	"headquarters_comment" text DEFAULT '' NOT NULL,
	"follow_up" text DEFAULT '' NOT NULL,
	"follow_up_date" date,
	"follow_up_done_at" timestamp(3),
	"follow_up_done_on" date,
	"follow_up_done_by_id" text,
	"follow_up_done_by_name" text DEFAULT '' NOT NULL,
	"follow_up_outcome" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_customer_id" text,
	"created_by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp(3) NOT NULL,
	"updated_by_id" text,
	"updated_by_customer_id" text,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"updated_at" timestamp(3),
	CONSTRAINT "visits_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "location_report_recipients" ADD CONSTRAINT "location_report_recipients_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_report_recipients" ADD CONSTRAINT "location_report_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_types" ADD CONSTRAINT "resource_types_family_resource_families_name_fk" FOREIGN KEY ("family") REFERENCES "public"."resource_families"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_name_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_location_id_locations_id_fk" FOREIGN KEY ("home_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_links" ADD CONSTRAINT "customer_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_links" ADD CONSTRAINT "customer_links_other_customer_id_customers_id_fk" FOREIGN KEY ("other_customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_logins" ADD CONSTRAINT "customer_logins_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_attachments" ADD CONSTRAINT "resource_attachments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_placement_visit_id_visits_id_fk" FOREIGN KEY ("placement_visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_resource_type_resource_types_name_fk" FOREIGN KEY ("resource_type") REFERENCES "public"."resource_types"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_follow_up_events" ADD CONSTRAINT "visit_follow_up_events_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_follow_up_events" ADD CONSTRAINT "visit_follow_up_events_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reactions" ADD CONSTRAINT "visit_reactions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reactions" ADD CONSTRAINT "visit_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_reactions" ADD CONSTRAINT "visit_reactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_follow_up_done_by_id_users_id_fk" FOREIGN KEY ("follow_up_done_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_customer_id_customers_id_fk" FOREIGN KEY ("created_by_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_updated_by_customer_id_customers_id_fk" FOREIGN KEY ("updated_by_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_name_key" ON "locations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "resource_types_family_idx" ON "resource_types" USING btree ("family");--> statement-breakpoint
CREATE INDEX "user_locations_location_idx" ON "user_locations" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_types_name_key" ON "visit_types" USING btree ("name");--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_logs_customer_idx" ON "activity_logs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "activity_logs_logged_at_idx" ON "activity_logs" USING btree ("logged_at");--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_idx" ON "customer_contacts" USING btree ("customer_id","position");--> statement-breakpoint
CREATE INDEX "customer_delete_backups_batch_idx" ON "customer_delete_backups" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "customer_delete_backups_customer_idx" ON "customer_delete_backups" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_links_other_idx" ON "customer_links" USING btree ("other_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_key" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_sps_key_key" ON "customers" USING btree ("sps_key");--> statement-breakpoint
CREATE INDEX "customers_location_status_idx" ON "customers" USING btree ("location_id","status");--> statement-breakpoint
CREATE INDEX "customers_sales_rep_status_idx" ON "customers" USING btree ("sales_rep_id","status");--> statement-breakpoint
CREATE INDEX "customers_company_contact_idx" ON "customers" USING btree ("company","contact_name");--> statement-breakpoint
CREATE INDEX "customers_city_idx" ON "customers" USING btree ("city");--> statement-breakpoint
CREATE INDEX "customers_type_level_idx" ON "customers" USING btree ("customer_type","level");--> statement-breakpoint
CREATE INDEX "customers_active_created_idx" ON "customers" USING btree ("is_active","created_at");--> statement-breakpoint
CREATE INDEX "resources_customer_idx" ON "resources" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "resources_type_idx" ON "resources" USING btree ("resource_type");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_placement_visit_key" ON "resources" USING btree ("placement_visit_id");--> statement-breakpoint
CREATE INDEX "schedules_user_start_idx" ON "schedules" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "schedules_customer_idx" ON "schedules" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "schedules_start_idx" ON "schedules" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "visit_reactions_visit_idx" ON "visit_reactions" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visits_customer_date_idx" ON "visits" USING btree ("customer_id","visit_date");--> statement-breakpoint
CREATE INDEX "visits_date_idx" ON "visits" USING btree ("visit_date");--> statement-breakpoint
CREATE INDEX "visits_created_by_date_idx" ON "visits" USING btree ("created_by_id","visit_date");--> statement-breakpoint
CREATE INDEX "visits_follow_up_due_idx" ON "visits" USING btree ("follow_up_date") WHERE follow_up_date is not null;