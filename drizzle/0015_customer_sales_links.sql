CREATE TABLE "customer_sales_links" (
	"sps_key" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"report_name" text DEFAULT '' NOT NULL,
	"linked_by" text DEFAULT '' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_sales_links" ADD CONSTRAINT "customer_sales_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_sales_links_customer_idx" ON "customer_sales_links" USING btree ("customer_id");