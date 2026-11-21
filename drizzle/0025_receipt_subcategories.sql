ALTER TABLE "card_expenses" ADD COLUMN "subcategory" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_categories" ADD COLUMN "subcategories" jsonb DEFAULT '[]'::jsonb NOT NULL;