CREATE TABLE "card_expense_history" (
	"expense_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"changes" text DEFAULT '' NOT NULL,
	CONSTRAINT "card_expense_history_expense_id_position_pk" PRIMARY KEY("expense_id","position")
);
--> statement-breakpoint
CREATE TABLE "card_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"holder_name" text DEFAULT '' NOT NULL,
	"card_id" text,
	"card_label" text NOT NULL,
	"location_id" text,
	"day" date NOT NULL,
	"month" text NOT NULL,
	"merchant" text NOT NULL,
	"cents" bigint NOT NULL,
	"subtotal_cents" bigint,
	"tax_cents" bigint,
	"tip_cents" bigint,
	"category" text,
	"customer_id" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"attendees" text[] DEFAULT '{}'::text[] NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"receipt_url" text DEFAULT '' NOT NULL,
	"lost_reason" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"approved_by_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"approval_comment" text,
	"sent_back_by_id" text,
	"sent_back_by_name" text,
	"sent_back_at" timestamp with time zone,
	"sent_back_comment" text,
	"created_by" text DEFAULT '' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text DEFAULT '' NOT NULL,
	"void_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_expenses_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "card_expenses_status" CHECK ("status" in ('missing', 'draft', 'waiting', 'sent_back', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "company_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"issuer" text DEFAULT 'amex' NOT NULL,
	"last_digits" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_cards_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "company_cards_issuer" CHECK ("issuer" in ('amex', 'other'))
);
--> statement-breakpoint
CREATE TABLE "receipt_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"needs_customer" boolean DEFAULT false NOT NULL,
	"needs_attendees" boolean DEFAULT false NOT NULL,
	"needs_purpose" boolean DEFAULT false NOT NULL,
	"needs_recurring" boolean DEFAULT false NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_categories_name_key" UNIQUE("name"),
	CONSTRAINT "receipt_categories_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "supplier_block_history" (
	"block_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"side" text DEFAULT 'staff' NOT NULL,
	"action" text NOT NULL,
	"changes" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_block_history_block_id_position_pk" PRIMARY KEY("block_id","position")
);
--> statement-breakpoint
CREATE TABLE "supplier_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"po_id" text NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"line_id" text NOT NULL,
	"material" text DEFAULT '' NOT NULL,
	"thickness" text DEFAULT '' NOT NULL,
	"finish" text DEFAULT '' NOT NULL,
	"block_number" text DEFAULT '' NOT NULL,
	"size_length" numeric,
	"size_height" numeric,
	"size_unit" text,
	"note" jsonb,
	"decision_note" jsonb,
	"stage" text DEFAULT 'draft' NOT NULL,
	"first_sent_at" timestamp with time zone,
	"entered_by" text DEFAULT '' NOT NULL,
	"entered_by_id" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_blocks_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "supplier_blocks_size_unit" CHECK ("size_unit" in ('in', 'cm'))
);
--> statement-breakpoint
CREATE TABLE "supplier_bundles" (
	"block_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"n" integer NOT NULL,
	"slabs" integer,
	"photo_url" text DEFAULT '' NOT NULL,
	"photo_at" timestamp with time zone,
	"previous_photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"step1_decision" text,
	"step1_by" text,
	"step1_by_name" text,
	"step1_at" timestamp with time zone,
	"step1_reason" text,
	"step2_decision" text,
	"step2_by" text,
	"step2_by_name" text,
	"step2_at" timestamp with time zone,
	"step2_reason" text,
	"reason" text DEFAULT '' NOT NULL,
	"comment" jsonb,
	"unlock_by" text,
	"unlock_at" timestamp with time zone,
	"unlock_reason" text,
	CONSTRAINT "supplier_bundles_block_id_id_pk" PRIMARY KEY("block_id","id"),
	CONSTRAINT "supplier_bundles_status" CHECK ("status" in ('draft', 'review', 'final', 'approved', 'rejected', 'retake', 'unlocked')),
	CONSTRAINT "supplier_bundles_step1_decision" CHECK ("step1_decision" in ('approve', 'reject', 'retake')),
	CONSTRAINT "supplier_bundles_step2_decision" CHECK ("step2_decision" in ('approve', 'reject', 'retake'))
);
--> statement-breakpoint
CREATE TABLE "supplier_history" (
	"supplier_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"side" text DEFAULT 'staff' NOT NULL,
	"action" text NOT NULL,
	"changes" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_history_supplier_id_position_pk" PRIMARY KEY("supplier_id","position")
);
--> statement-breakpoint
CREATE TABLE "supplier_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"link_token_hash" text DEFAULT '' NOT NULL,
	"link_expires_at" timestamp with time zone,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"lock_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"invited_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_logins_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "supplier_po_history" (
	"po_id" text NOT NULL,
	"position" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"side" text DEFAULT 'staff' NOT NULL,
	"action" text NOT NULL,
	"changes" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_po_history_po_id_position_pk" PRIMARY KEY("po_id","position")
);
--> statement-breakpoint
CREATE TABLE "supplier_po_lines" (
	"po_id" text NOT NULL,
	"id" text NOT NULL,
	"position" integer NOT NULL,
	"material" text NOT NULL,
	"thickness" text DEFAULT '' NOT NULL,
	"finish" text DEFAULT '' NOT NULL,
	"slabs" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_po_lines_po_id_id_pk" PRIMARY KEY("po_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_pos" (
	"id" text PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" text NOT NULL,
	"supplier_name" text DEFAULT '' NOT NULL,
	"ship_to" text DEFAULT '' NOT NULL,
	"ready_by" date,
	"buyer_id" text DEFAULT '' NOT NULL,
	"buyer_name" text DEFAULT '' NOT NULL,
	"note" jsonb,
	"source" text DEFAULT 'typed' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_reason" text DEFAULT '' NOT NULL,
	"assigned_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_pos_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "supplier_pos_source" CHECK ("source" in ('typed', 'sps')),
	CONSTRAINT "supplier_pos_status" CHECK ("status" in ('open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sps_name" text DEFAULT '' NOT NULL,
	"sps_key" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"time_zone" text DEFAULT '' NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "card_expense_history" ADD CONSTRAINT "card_expense_history_expense_id_card_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."card_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD CONSTRAINT "card_expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD CONSTRAINT "card_expenses_card_id_company_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."company_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD CONSTRAINT "card_expenses_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD CONSTRAINT "card_expenses_category_receipt_categories_name_fk" FOREIGN KEY ("category") REFERENCES "public"."receipt_categories"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD CONSTRAINT "card_expenses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_cards" ADD CONSTRAINT "company_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_block_history" ADD CONSTRAINT "supplier_block_history_block_id_supplier_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."supplier_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_blocks" ADD CONSTRAINT "supplier_blocks_po_id_supplier_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."supplier_pos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_blocks" ADD CONSTRAINT "supplier_blocks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bundles" ADD CONSTRAINT "supplier_bundles_block_id_supplier_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."supplier_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_history" ADD CONSTRAINT "supplier_history_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_logins" ADD CONSTRAINT "supplier_logins_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_po_history" ADD CONSTRAINT "supplier_po_history_po_id_supplier_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."supplier_pos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_po_lines" ADD CONSTRAINT "supplier_po_lines_po_id_supplier_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."supplier_pos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_pos" ADD CONSTRAINT "supplier_pos_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_expenses_month_day_idx" ON "card_expenses" USING btree ("month","day");--> statement-breakpoint
CREATE INDEX "card_expenses_user_month_idx" ON "card_expenses" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "card_expenses_status_user_idx" ON "card_expenses" USING btree ("status","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_cards_active_user_key" ON "company_cards" USING btree ("user_id") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "company_cards_active_label_key" ON "company_cards" USING btree ("label") WHERE active;--> statement-breakpoint
CREATE INDEX "supplier_blocks_po_idx" ON "supplier_blocks" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "supplier_blocks_supplier_stage_idx" ON "supplier_blocks" USING btree ("supplier_id","stage");--> statement-breakpoint
CREATE INDEX "supplier_blocks_stage_sent_idx" ON "supplier_blocks" USING btree ("stage","sent_at");--> statement-breakpoint
CREATE INDEX "supplier_bundles_status_idx" ON "supplier_bundles" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_logins_email_key" ON "supplier_logins" USING btree ("email");--> statement-breakpoint
CREATE INDEX "supplier_logins_supplier_idx" ON "supplier_logins" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_logins_link_idx" ON "supplier_logins" USING btree ("link_token_hash") WHERE link_token_hash > '';--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_po_lines_position_key" ON "supplier_po_lines" USING btree ("po_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_pos_number_key" ON "supplier_pos" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "supplier_pos_supplier_status_idx" ON "supplier_pos" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "supplier_pos_status_updated_idx" ON "supplier_pos" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_sps_key_key" ON "suppliers" USING btree ("sps_key") WHERE sps_key > '';--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");