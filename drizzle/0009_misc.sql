CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "cloudinary_to_s3_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"collection" text NOT NULL,
	"doc_id" text NOT NULL,
	"fields" jsonb NOT NULL,
	"at" timestamp with time zone,
	CONSTRAINT "cloudinary_to_s3_backups_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "contact_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text NOT NULL,
	"phone" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_submissions_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "contact_submissions_status" CHECK ("status" in ('new', 'read', 'replied'))
);
--> statement-breakpoint
CREATE TABLE "crossover_colors" (
	"id" text PRIMARY KEY NOT NULL,
	"easy_stones_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crossover_colors_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "crossovers" (
	"id" text PRIMARY KEY NOT NULL,
	"color_id" text NOT NULL,
	"position" integer NOT NULL,
	"distributor_name" text NOT NULL,
	"distributor_color_name" text NOT NULL,
	"match_type" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"added_by_name" text DEFAULT '' NOT NULL,
	"added_by_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crossovers_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "crossovers_match_type" CHECK ("match_type" in ('Direct Crossover', 'Similar'))
);
--> statement-breakpoint
CREATE TABLE "easy_stones_colors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "easy_stones_colors_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "import_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"rep_aliases" jsonb NOT NULL,
	"branch_aliases" jsonb NOT NULL,
	"decisions" jsonb NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_memories_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "legacy_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"customer_type" text,
	"priority" text,
	"segment" text,
	"moda_binder" text,
	"moda_display" text,
	"follow_up_date" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_leads_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "legacy_sales_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"last_visit" timestamp with time zone,
	"next_visit" timestamp with time zone,
	"status" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_sales_customers_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "lost_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"customer_id" text,
	"product_name" text NOT NULL,
	"product_id" text,
	"length_inches" numeric,
	"width_inches" numeric,
	"sf_per_slab" numeric,
	"slabs_count" numeric,
	"total_sf" numeric,
	"price_per_sf" numeric,
	"total_lost_value" numeric,
	"reason" text NOT NULL,
	"location_id" text,
	"competitor_name" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sales_rep_name" text DEFAULT '' NOT NULL,
	"sales_rep_id" text,
	"lost_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_sales_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "product_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"position" integer NOT NULL,
	"bundle_number" text,
	"serial" text,
	"avg_size" text,
	"qty" text,
	"location" text,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "product_bundles_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "product_colors" (
	"product_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"image" text,
	CONSTRAINT "product_colors_product_id_position_pk" PRIMARY KEY("product_id","position")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"product_number" integer NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"collection_type" text,
	"availability" text DEFAULT 'In Stock' NOT NULL,
	"image" text,
	"installed_images" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_new_arrival" boolean DEFAULT false NOT NULL,
	"show_in_slider" boolean DEFAULT false NOT NULL,
	"thickness" text[] DEFAULT '{}'::text[] NOT NULL,
	"sizes" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"primary_color" text,
	"accent_color" text,
	"style" text,
	"variations" text DEFAULT 'Low' NOT NULL,
	"finishes" text[] DEFAULT '{}'::text[] NOT NULL,
	"applications" text[] DEFAULT '{}'::text[] NOT NULL,
	"book_match" text DEFAULT 'N/A' NOT NULL,
	"landing_cost" numeric,
	"price_level1" numeric,
	"price_level2" numeric,
	"price_level3" numeric,
	"price_level4" numeric,
	"price" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "products_book_match" CHECK ("book_match" in ('N/A', 'Yes', 'No'))
);
--> statement-breakpoint
CREATE TABLE "sales_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_resources_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "sps_import_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"key" text NOT NULL,
	"row_number" integer DEFAULT 0 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"connect" boolean DEFAULT false NOT NULL,
	"create" jsonb,
	"apply" jsonb,
	"before" jsonb,
	"unset" text[] DEFAULT '{}'::text[] NOT NULL,
	"changes" jsonb,
	"deleted" jsonb,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"result" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_id" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sps_import_items_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "sps_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"file" "bytea",
	"created_by" text DEFAULT '' NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"mapping" jsonb NOT NULL,
	"rep_aliases" jsonb NOT NULL,
	"branch_aliases" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"file_check" jsonb,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"results" jsonb NOT NULL,
	"plan_counts" jsonb NOT NULL,
	"verify" jsonb,
	"error" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"undone_by" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sps_import_runs_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "team_files" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"thumbnail" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"is_folder" boolean DEFAULT false NOT NULL,
	"parent_id" text,
	"uploaded_by" text,
	"size" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"pinned_at" text,
	"pinned_by" text,
	"updated_by" text,
	"updated_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_files_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "crossovers" ADD CONSTRAINT "crossovers_color_id_crossover_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."crossover_colors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_sales" ADD CONSTRAINT "lost_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_sales" ADD CONSTRAINT "lost_sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_sales" ADD CONSTRAINT "lost_sales_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundles" ADD CONSTRAINT "product_bundles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_colors" ADD CONSTRAINT "product_colors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sps_import_items" ADD CONSTRAINT "sps_import_items_run_id_sps_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sps_import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "cloudinary_to_s3_backups_run_idx" ON "cloudinary_to_s3_backups" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crossover_colors_name_key" ON "crossover_colors" USING btree ("easy_stones_name");--> statement-breakpoint
CREATE INDEX "crossovers_distributor_idx" ON "crossovers" USING btree ("distributor_name");--> statement-breakpoint
CREATE UNIQUE INDEX "easy_stones_colors_name_key" ON "easy_stones_colors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "import_memories_kind_key" ON "import_memories" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "lost_sales_lost_at_idx" ON "lost_sales" USING btree ("lost_at");--> statement-breakpoint
CREATE INDEX "lost_sales_location_idx" ON "lost_sales" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "lost_sales_reason_idx" ON "lost_sales" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "product_bundles_position_key" ON "product_bundles" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "products_number_key" ON "products" USING btree ("product_number");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category","availability","product_number");--> statement-breakpoint
CREATE INDEX "sps_import_items_run_seq_idx" ON "sps_import_items" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "sps_import_items_run_state_idx" ON "sps_import_items" USING btree ("run_id","state","seq");--> statement-breakpoint
CREATE INDEX "sps_import_runs_status_idx" ON "sps_import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_files_parent_idx" ON "team_files" USING btree ("parent_id","is_folder","created_at");--> statement-breakpoint
CREATE INDEX "team_files_pinned_idx" ON "team_files" USING btree ("pinned","pinned_at");