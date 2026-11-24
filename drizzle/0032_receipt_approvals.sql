ALTER TABLE "card_expenses" ADD COLUMN "approved_as" text;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD COLUMN "second_approval" jsonb;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD COLUMN "ask" jsonb;--> statement-breakpoint
ALTER TABLE "card_expenses" ADD COLUMN "reminders" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- 2026-11-23 approval rules (src/utils/receiptApproval.ts). A receipt still waiting with a step 1 from the old
-- rules keeps it where it belongs now: an Accounting member's as the Accounting approval, anyone else's
-- (a manager, director or admin) as the second approval.
UPDATE "card_expenses" e SET
  "second_approval" = jsonb_build_object(
    'by', e."approved_by_id", 'byName', coalesce(e."approved_by_name", ''),
    'at', to_char(e."approved_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'comment', coalesce(e."approval_comment", ''),
    'as', CASE WHEN EXISTS (SELECT 1 FROM "users" u WHERE u."id" = lower(e."approved_by_id") AND u."role" = 'admin') THEN 'admin' ELSE 'manager' END),
  "approved_by_id" = NULL, "approved_by_name" = NULL, "approved_at" = NULL, "approval_comment" = NULL
WHERE e."status" = 'waiting' AND e."approved_by_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = lower(e."approved_by_id") AND u."role" = 'accounting');--> statement-breakpoint
UPDATE "card_expenses" SET "approved_as" = 'accounting'
WHERE "status" = 'waiting' AND "approved_by_id" IS NOT NULL AND "approved_as" IS NULL;--> statement-breakpoint
-- An Admin's charge with no upload waits for Accounting instead of showing as Missing receipt.
INSERT INTO "card_expense_history" ("expense_id", "position", "at", "by", "action", "changes")
SELECT e."id", coalesce((SELECT max(h."position") + 1 FROM "card_expense_history" h WHERE h."expense_id" = e."id"), 0),
  now(), 'Easy Surfaces', 'edited', 'An Admin’s charge: waiting for Accounting'
FROM "card_expenses" e
WHERE e."status" = 'missing' AND e."voided_at" IS NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = e."user_id" AND u."role" = 'admin');--> statement-breakpoint
UPDATE "card_expenses" e SET "status" = 'waiting', "updated_at" = now()
WHERE e."status" = 'missing' AND e."voided_at" IS NULL
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = e."user_id" AND u."role" = 'admin');
