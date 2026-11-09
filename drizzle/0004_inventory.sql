CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"product" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"generic_sku" text DEFAULT '' NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"sub_category" text DEFAULT '' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT '' NOT NULL,
	"serial_number" text DEFAULT '' NOT NULL,
	"barcode_id" text DEFAULT '' NOT NULL,
	"bundle" text DEFAULT '' NOT NULL,
	"slab_number" text DEFAULT '' NOT NULL,
	"block" text DEFAULT '' NOT NULL,
	"id_four" text DEFAULT '' NOT NULL,
	"id_five" text DEFAULT '' NOT NULL,
	"supp_barcode_id" text DEFAULT '' NOT NULL,
	"bin" text DEFAULT '' NOT NULL,
	"dimensions" text DEFAULT '' NOT NULL,
	"instock_qty" numeric DEFAULT '0' NOT NULL,
	"available_slabs" numeric DEFAULT '0' NOT NULL,
	"available_quantity" numeric DEFAULT '0' NOT NULL,
	"units" text DEFAULT '' NOT NULL,
	"supplier" text DEFAULT '' NOT NULL,
	"unit_fob_cost" numeric DEFAULT '0' NOT NULL,
	"unit_landed_cost" numeric DEFAULT '0' NOT NULL,
	"purchase_cost" numeric DEFAULT '0' NOT NULL,
	"asset_value" numeric DEFAULT '0' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"slab_status" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"remnant" text DEFAULT '' NOT NULL,
	"received_date" timestamp with time zone,
	"imported_at" timestamp with time zone NOT NULL,
	"imported_by_name" text DEFAULT '' NOT NULL,
	"imported_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_sales_records" (
	"id" text PRIMARY KEY NOT NULL,
	"product" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"sub_category" text DEFAULT '' NOT NULL,
	"group" text DEFAULT '' NOT NULL,
	"origin" text DEFAULT '' NOT NULL,
	"slabs_sold" numeric DEFAULT '0' NOT NULL,
	"quantity_sold" numeric DEFAULT '0' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"sale_value" numeric DEFAULT '0' NOT NULL,
	"cost" numeric DEFAULT '0' NOT NULL,
	"avg_selling_price" numeric DEFAULT '0' NOT NULL,
	"avg_cost" numeric DEFAULT '0' NOT NULL,
	"margin" numeric DEFAULT '0' NOT NULL,
	"margin_percent" numeric DEFAULT '0' NOT NULL,
	"location" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"imported_by_name" text DEFAULT '' NOT NULL,
	"imported_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_sales_records_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"chunk" integer NOT NULL,
	"items" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"source_filename" text DEFAULT '' NOT NULL,
	"source_hash" text DEFAULT '' NOT NULL,
	"count" integer NOT NULL,
	"previous_count" integer NOT NULL,
	"backup_chunks" integer NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"imported_by_id" text,
	"imported_by_name" text DEFAULT '' NOT NULL,
	"backup_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_stock_state" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"import_id" text
);
--> statement-breakpoint
CREATE TABLE "inventory_transit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"report_id" text,
	"at" timestamp with time zone NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"snapshot" jsonb,
	CONSTRAINT "inventory_transit_events_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "inventory_transit_events_action" CHECK ("action" in ('reported', 'not-reported', 'receipt-confirmed'))
);
--> statement-breakpoint
CREATE TABLE "inventory_transit_lines" (
	"shipment_id" text NOT NULL,
	"position" integer NOT NULL,
	"product" text,
	"sku" text,
	"po_number" text,
	"container_number" text,
	"location" text,
	"po_date" timestamp with time zone,
	"po_eta_date" timestamp with time zone,
	"supplier_so_number" text,
	"sipl_number" text,
	"slabs" numeric,
	"quantity" numeric,
	"units" text,
	"supplier" text,
	"freight_forwarder" text,
	"ship_date" timestamp with time zone,
	"port_eta_date" timestamp with time zone,
	"eta_date" timestamp with time zone,
	"vessel" text,
	"customer_reference" text,
	"supplier_purchase_note" text,
	"status" text,
	CONSTRAINT "inventory_transit_lines_shipment_id_position_pk" PRIMARY KEY("shipment_id","position")
);
--> statement-breakpoint
CREATE TABLE "inventory_transit_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"branches" text[] DEFAULT '{}'::text[] NOT NULL,
	"complete" boolean,
	"source_filename" text,
	"source_hash" text,
	"imported_at" timestamp with time zone,
	"imported_by_name" text,
	"line_count" integer,
	"shipment_count" integer,
	"withdrawn_count" integer
);
--> statement-breakpoint
CREATE TABLE "inventory_transit_shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"po_number" text DEFAULT '' NOT NULL,
	"container_number" text DEFAULT '' NOT NULL,
	"location" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"report_id" text,
	"source_signature" text,
	"confirmed_signature" text,
	"usable_receipt_date" timestamp with time zone,
	"receipt_confirmed_at" timestamp with time zone,
	"receipt_confirmed_by" text,
	"inactive_at" timestamp with time zone,
	"inactive_reason" text,
	"imported_at" timestamp with time zone,
	"imported_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transit_shipments_id_format" CHECK ("id" ~ '^[0-9a-f]{24}$')
);
--> statement-breakpoint
ALTER TABLE "inventory_transit_lines" ADD CONSTRAINT "inventory_transit_lines_shipment_id_inventory_transit_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."inventory_transit_shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_product_idx" ON "inventory_items" USING btree ("product");--> statement-breakpoint
CREATE INDEX "inventory_items_category_idx" ON "inventory_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "inventory_items_location_idx" ON "inventory_items" USING btree ("location");--> statement-breakpoint
CREATE INDEX "inventory_items_received_idx" ON "inventory_items" USING btree ("received_date");--> statement-breakpoint
CREATE INDEX "inventory_items_imported_idx" ON "inventory_items" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX "inventory_items_serial_ci_idx" ON "inventory_items" USING btree (lower("serial_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_sales_records_period_product_key" ON "inventory_sales_records" USING btree ("location","period_start","period_end","product");--> statement-breakpoint
CREATE INDEX "inventory_stock_backups_import_idx" ON "inventory_stock_backups" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "inventory_stock_backups_expires_idx" ON "inventory_stock_backups" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_stock_imports_imported_idx" ON "inventory_stock_imports" USING btree ("imported_at");--> statement-breakpoint
CREATE INDEX "inventory_transit_events_shipment_idx" ON "inventory_transit_events" USING btree ("shipment_id","at");--> statement-breakpoint
CREATE INDEX "inventory_transit_reports_imported_idx" ON "inventory_transit_reports" USING btree ("imported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transit_shipments_po_container_location_key" ON "inventory_transit_shipments" USING btree ("po_number","container_number","location");--> statement-breakpoint
CREATE INDEX "inventory_transit_shipments_active_location_idx" ON "inventory_transit_shipments" USING btree ("active","location");