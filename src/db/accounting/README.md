# Accounting (3rd-party freight) on Postgres (switch `DB_ACCOUNTING`)

`src/accounting/router.ts` (carriers, freight charges, carrier invoices, payments) and
`src/accounting/sync.ts` (charges made from the Delivery Schedule) read and write only through a
**store** (`index.ts`), one per unit of work: `inAccountingTransaction` for a write that must land whole
(a change and its history line, a payment and every charge it paid), `accountingStore()` for reads.
`mongo.ts` is the old Mongoose code moved behind the store; `postgres.ts` is SQL. Unset = MongoDB.
**Fuel Man is a separate area** (`src/db/fuelman/`, its own switch and cutover).

- Postgres answers in MongoDB's shape (`accountingDoc.ts`): `_id`, `__v`, `createdBy: { id, name }`, a charge's
  `payment`, `flags` and `sourceSnapshot` inside it, an invoice's `chargeIds`, a payment's `chargeIds`.
- A save builds the record as MongoDB would hold it (same defaults), then makes its rows with the copy's own
  per-record builders (`carrierRowOf`, `chargeRowsOf`, `invoiceRowOf`, `paymentRowsOf`, `auditRowOf` in
  `src/db/copy/accountingRows.ts`), so it writes what a re-copy of MongoDB would.
- New ids (and TX- / PAY- ids) are made in the layer, so both databases get the same one in the tests.
- `accounting.parity.test.ts` runs every route and the delivery sync on both and compares the answers and every
  `acct_*` table (`verifyCopy`), plus the scoped cutover copy. `router.test.ts` (MongoDB) still runs unchanged.

## How the rules are kept

- **A stale screen can't overwrite:** `save…` is `UPDATE … WHERE version = __v`; none matched → the route's 409.
- **One charge per delivery:** `acct_freight_charges` is unique on the delivery's ticket id; a race on the sync's
  create answers as MongoDB's duplicate key (code 11000) and the sync retries.
- **Pay twice:** `acct_payments` is unique on `request_id`; the route checks first and a race is a 409.
- **History and payments are append-only** (only ever inserted).
- **One transaction** per change: the change, its history line and (for a payment) the register row.

## Intended differences

- **A charge's branch must be on the Locations list.** MongoDB keeps any branch text an all-branches login types;
  Postgres can't link one that isn't a location, and answers 400 "There is no branch called …".
- Everything else the copy blanks or skips is in the copy report (a charge with an unknown branch is invisible to
  branch logins on both databases).
- Staff ids (`created_by` …) are plain text, as stored, until Users moves.

## Cutover

Pause (`ACCOUNTING_WRITES_PAUSED=true`: carrier / charge / invoice / payment writes answer 503, the freight sync
waits; reads and Fuel Man carry on) → `pg-copy-aws.ts --scope accounting --write` → `--verify` → `DB_ACCOUNTING=postgres`
→ pause off → `--lock … --scope accounting`. The sync's catch-up (boot and every 10 minutes) fills anything the pause
skipped. Check first on live data: `node --env-file=.env scripts/pg-compare-accounting.ts` (read-only).
