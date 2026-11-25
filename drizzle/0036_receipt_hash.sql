ALTER TABLE "card_expenses" ADD COLUMN "receipt_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "card_expenses_receipt_hash_idx" ON "card_expenses" USING btree ("receipt_hash");