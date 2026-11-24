CREATE TABLE "card_expense_deletions" (
	"expense_id" text PRIMARY KEY NOT NULL,
	"expense" jsonb NOT NULL,
	"deleted_by" text NOT NULL,
	"reason" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
