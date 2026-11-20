CREATE TABLE "card_statement_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"period_from" date,
	"period_to" date,
	"lines" integer NOT NULL,
	"added" integer NOT NULL,
	"charges_cents" bigint DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_id" text DEFAULT '' NOT NULL,
	"by_name" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_statement_lines" (
	"reference" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"card_member" text DEFAULT '' NOT NULL,
	"digits" text NOT NULL,
	"cents" integer NOT NULL,
	"kind" text NOT NULL,
	"amex_category" text DEFAULT '' NOT NULL,
	"extended" text DEFAULT '' NOT NULL,
	"appears_as" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city_state" text DEFAULT '' NOT NULL,
	"zip" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"card_id" text,
	"expense_id" text,
	"first_import_id" text NOT NULL,
	"last_import_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_statement_lines_kind" CHECK ("kind" in ('charge', 'credit', 'fee'))
);
--> statement-breakpoint
CREATE INDEX "card_statement_imports_at_idx" ON "card_statement_imports" USING btree ("at");--> statement-breakpoint
CREATE INDEX "card_statement_lines_day_idx" ON "card_statement_lines" USING btree ("day");--> statement-breakpoint
CREATE INDEX "card_statement_lines_digits_idx" ON "card_statement_lines" USING btree ("digits");--> statement-breakpoint
CREATE INDEX "card_statement_lines_card_idx" ON "card_statement_lines" USING btree ("card_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "card_statement_lines_expense_key" ON "card_statement_lines" USING btree ("expense_id") WHERE expense_id is not null;