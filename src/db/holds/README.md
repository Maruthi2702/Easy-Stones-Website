# Cart & Holds on Postgres (switch `DB_HOLDS`)

`src/holds/router.ts` (carts, holds, slab locks) and `src/holds/expiry.ts` (the expiry job) read and
write only through a **store** (`index.ts`), one per unit of work: `inHoldsTransaction` for a write that
must land whole (a hold, its locks, its history), `holdsStore()` for reads and single writes.
`mongo.ts` is the old Mongoose code moved behind the store; `postgres.ts` is SQL. Unset = MongoDB.
Purchasing reads the slab locks at its branches through `lockedSlabsAtBranches` (its own session / transaction).

- Postgres answers in MongoDB's shape (`holdDoc.ts`): `_id`, `__v`, `customer: { id, name… }`,
  `createdBy: { id, name }`, `lines` inside the hold, `releasedBy: null` until released.
- A save builds the record as MongoDB would hold it (same defaults), then makes its rows with the copy's
  own builders (`holdRowsOf`, `cartRowsOf`, `reservationRowOf`, `holdHistoryRowOf` in
  `src/db/copy/checkInsHoldsRows.ts`), so it writes what a re-copy of MongoDB would.
- New ids are made in the layer with `newId()`, so both databases get the same one.
- `holds.parity.test.ts` runs every route and the expiry job on both and compares the answers and every
  table (`verifyCopy`); `holds.concurrency.test.ts` makes the races overlap on a real Postgres
  (`PG_RACE_URL=postgres:///es_race`; skipped without it).

## How the rules are kept

- **One hold per slab:** `sales_slab_reservations` is unique on `slab_key`; a lock is `INSERT … ON CONFLICT
  DO NOTHING`, and if fewer rows went in the layer answers with every lock on those slabs and the route
  refuses the whole request (the transaction rolls back, the hold number with it, so numbers stay dense).
- **A stale screen can't overwrite:** `saveHold` is `UPDATE … WHERE version = __v`; none matched → 409.
- **Carts:** every cart write is its own transaction with the cart's row locked, so two tabs take turns and
  a slab lands once. Lines are numbered 0, 1, 2… again after a removal, as the copy numbers MongoDB's array.
- **The stock revision** (`inventoryTransaction.ts`) is bumped right after a hold's Postgres commit
  (inside the MongoDB transaction on MongoDB), in whichever database `DB_INVENTORY` says.

## Intended differences

- **`sales_carts.user_id` is not a foreign key** (migration 0013): staff are added in MongoDB until Users moves
  (last), and their first cart must save. The copy keeps the user id as it is.
- **A hold whose customer was deleted** keeps the customer's name but not the id in Postgres (`customer_id` is
  `set null`); MongoDB keeps the id string. The list and the letter print the name.
- A hold's branch must exist in `locations` (the copy of MongoDB's); a branch added in MongoDB after the copy
  can't take a hold on Postgres until Locations moves.

## Cutover

Pause (`HOLDS_WRITES_PAUSED=true`: cart and hold writes answer 503, the expiry job waits; the slab-status
lookup and reads carry on) → `pg-copy-aws.ts --scope holds --write` → `--verify` → `DB_HOLDS=postgres` →
pause off → `--lock … --scope holds`. Active holds survive the move with their locks; `sales_counters` carries
the next hold number.
