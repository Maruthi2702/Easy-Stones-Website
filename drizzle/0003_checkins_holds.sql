CREATE TABLE "check_in_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"check_in_id" text NOT NULL,
	"position" integer NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"lot" text DEFAULT '' NOT NULL,
	"price_cents_per_sf" integer,
	CONSTRAINT "check_in_selections_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "check_in_selections_price" CHECK (price_cents_per_sf is null or price_cents_per_sf >= 1)
);
--> statement-breakpoint
CREATE TABLE "office_check_ins" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location_id" text,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"fabricator_company" text DEFAULT '' NOT NULL,
	"fabricator_name" text DEFAULT '' NOT NULL,
	"fabricator_phone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"builder_name" text DEFAULT '' NOT NULL,
	"builder_phone" text DEFAULT '' NOT NULL,
	"special_notes" text DEFAULT '' NOT NULL,
	"internal_notes" text DEFAULT '' NOT NULL,
	"sales_rep_name" text DEFAULT '' NOT NULL,
	"sales_rep_email" text DEFAULT '' NOT NULL,
	"sheet_edited_by" text DEFAULT '' NOT NULL,
	"sheet_edited_at" timestamp with time zone,
	"logged_by_user_id" text,
	"logged_by_username" text DEFAULT '' NOT NULL,
	"logged_by_display_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_check_ins_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "office_check_ins_status" CHECK ("status" in ('New', 'Processed'))
);
--> statement-breakpoint
CREATE TABLE "sales_cart_lines" (
	"cart_id" text NOT NULL,
	"position" integer NOT NULL,
	"slab_key" text NOT NULL,
	"product" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_cart_lines_cart_id_position_pk" PRIMARY KEY("cart_id","position")
);
--> statement-breakpoint
CREATE TABLE "sales_carts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"customer_id" text,
	"customer_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_carts_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "sales_counters" (
	"name" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_hold_history" (
	"id" text PRIMARY KEY NOT NULL,
	"hold_id" text NOT NULL,
	"hold_number" integer NOT NULL,
	"action" text NOT NULL,
	"by_id" text DEFAULT '' NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "sales_hold_history_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "sales_hold_lines" (
	"hold_id" text NOT NULL,
	"position" integer NOT NULL,
	"slab_key" text NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"barcode" text DEFAULT '' NOT NULL,
	"product" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"bundle" text DEFAULT '' NOT NULL,
	"slab_number" text DEFAULT '' NOT NULL,
	"block" text DEFAULT '' NOT NULL,
	"bin" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"dimensions" text DEFAULT '' NOT NULL,
	"sf_hundredths" integer NOT NULL,
	"price_cents_per_sf" integer,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "sales_hold_lines_hold_id_position_pk" PRIMARY KEY("hold_id","position")
);
--> statement-breakpoint
CREATE TABLE "sales_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"location_id" text NOT NULL,
	"customer_id" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_contact" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_address" text DEFAULT '' NOT NULL,
	"job" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"commission_notes" text DEFAULT '' NOT NULL,
	"chance_to_close" integer,
	"expires_on" date NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"expired_noted_at" timestamp with time zone,
	"slab_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by_id" text DEFAULT '' NOT NULL,
	"created_by_name" text DEFAULT '' NOT NULL,
	"updated_by_id" text DEFAULT '' NOT NULL,
	"updated_by_name" text DEFAULT '' NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_id" text,
	"released_by_name" text,
	"release_reason" text DEFAULT '' NOT NULL,
	"request_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_holds_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "sales_holds_status" CHECK ("status" in ('active', 'released', 'converted')),
	CONSTRAINT "sales_holds_chance" CHECK (chance_to_close is null or chance_to_close between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "sales_slab_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"slab_key" text NOT NULL,
	"hold_id" text NOT NULL,
	"hold_number" integer NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"by_id" text DEFAULT '' NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_slab_reservations_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "check_in_selections" ADD CONSTRAINT "check_in_selections_check_in_id_office_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."office_check_ins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_check_ins" ADD CONSTRAINT "office_check_ins_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_check_ins" ADD CONSTRAINT "office_check_ins_logged_by_user_id_users_id_fk" FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_cart_lines" ADD CONSTRAINT "sales_cart_lines_cart_id_sales_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."sales_carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_carts" ADD CONSTRAINT "sales_carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_carts" ADD CONSTRAINT "sales_carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_hold_lines" ADD CONSTRAINT "sales_hold_lines_hold_id_sales_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."sales_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_holds" ADD CONSTRAINT "sales_holds_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_holds" ADD CONSTRAINT "sales_holds_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_slab_reservations" ADD CONSTRAINT "sales_slab_reservations_hold_id_sales_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."sales_holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "check_in_selections_position_key" ON "check_in_selections" USING btree ("check_in_id","position");--> statement-breakpoint
CREATE INDEX "office_check_ins_location_created_idx" ON "office_check_ins" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE INDEX "office_check_ins_phone_idx" ON "office_check_ins" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "sales_cart_lines_slab_idx" ON "sales_cart_lines" USING btree ("slab_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_carts_user_key" ON "sales_carts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sales_hold_history_hold_idx" ON "sales_hold_history" USING btree ("hold_id","at");--> statement-breakpoint
CREATE INDEX "sales_hold_lines_slab_idx" ON "sales_hold_lines" USING btree ("slab_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_holds_number_key" ON "sales_holds" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_holds_request_key" ON "sales_holds" USING btree ("request_id") WHERE request_id is not null;--> statement-breakpoint
CREATE INDEX "sales_holds_status_location_idx" ON "sales_holds" USING btree ("status","location_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_holds_created_by_idx" ON "sales_holds" USING btree ("created_by_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_slab_reservations_slab_key" ON "sales_slab_reservations" USING btree ("slab_key");