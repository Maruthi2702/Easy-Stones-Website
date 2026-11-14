# Credit Card Receipts on Postgres (switch `DB_CARD_RECEIPTS`)

`src/routes/cardReceipts.ts` reads and writes company cards, receipt categories and card
expenses only through `index.ts`, which picks `mongo.ts` (the route's old Mongoose calls,
moved unchanged) or `postgres.ts` by `DB_CARD_RECEIPTS=postgres`. Unset = MongoDB.

- Postgres answers in MongoDB's shape (`cardDocs.ts`): `_id`, `location` (the branch's
  name), `date`, `approval` / `sentBack` as objects, `history` inside the expense.
- A Postgres save builds the record as MongoDB would hold it, then makes its rows with the
  copy's own builders (`companyCardRowOf`, `receiptCategoryRowOf`, `cardExpenseRowsOf` in
  `src/db/copy/cardsSuppliersRows.ts`) — so a save writes what a re-copy would.
- New ids are made by the route (`newId()`), so both databases hold the same one.
- Users and Roles (who approves whom, the people list) stay on MongoDB until Users moves.
  A card for a person who isn't in Postgres yet (the reference sync lags up to 10 minutes)
  is refused with an error, not stored without its holder.
- The expense list now breaks ties by id (MongoDB's order was arbitrary for equal
  day + time).

## Verified

- `cardReceipts.parity.test.ts` (16 cases through the real router, every request on both
  databases; `t.differences()` = the copy's own check of every table afterwards).
- `scripts/pg-compare-card-receipts.ts` on live data (2026-11-14): 6 requests, 0 differences.
  Live holds only 2 expenses and 1 card so far, so this proves little; the parity test is the
  real evidence.

## Cutover (not done)

`CARD_RECEIPTS_WRITES_PAUSED=true` (503 on every write under `/api/card-receipts`, shown on
`/api/health`) → `pg-copy-aws.ts --deploy` (new scope) → `--scope card_receipts --write`,
`--verify` → `DB_CARD_RECEIPTS=postgres` on Render → pause off → `--lock … --scope card_receipts`.
