ALTER TABLE "company_cards" DROP CONSTRAINT "company_cards_issuer";--> statement-breakpoint
DROP INDEX "company_cards_active_user_key";--> statement-breakpoint
ALTER TABLE "card_statement_imports" ADD COLUMN "issuer" text DEFAULT 'amex' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_statement_lines" ADD COLUMN "issuer" text DEFAULT 'amex' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "company_cards_active_user_issuer_key" ON "company_cards" USING btree ("user_id","issuer") WHERE active;--> statement-breakpoint
ALTER TABLE "company_cards" ADD CONSTRAINT "company_cards_issuer" CHECK ("issuer" in ('amex', 'encore', 'other'));--> statement-breakpoint
ALTER TABLE "card_statement_lines" ADD CONSTRAINT "card_statement_lines_issuer" CHECK ("issuer" in ('amex', 'encore'));