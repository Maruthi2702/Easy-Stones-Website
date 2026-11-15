# Purchasing on Postgres (switch `DB_PURCHASING`)

`src/purchasing/` (router, draft routes, data) reads and writes scopes, incoming-supply
imports, order drafts, locks and PO links only through a **store** (`index.ts`), one per
unit of work: `inPurchasingTransaction` for a write, `inPurchasingSnapshot` for a read.
`mongo.ts` is the old Mongoose code moved unchanged; `postgres.ts` is SQL. Unset = MongoDB.

- Postgres answers in MongoDB's shape (`docs.ts`): `_id`, `__v`, `createdBy: { id, name }`,
  history inside the draft, a scope's container as one object, and **MongoDB's key order**
  (a plan's `fingerprint` hashes the scope's JSON). A null column is left out, except
  `cohortRevision` and `salesCoverageConfirmation`, which MongoDB holds as null on every
  scope the router saved.
- A save builds the record as MongoDB would hold it and makes its rows with the copy's own
  builder (`purchasingRows`), so it writes what a re-copy would.
- New ids are made by the route (`newId()`) and handed to whichever database saves.

## Stock, sales, reservations, transit and the revision stay on MongoDB

`sources.ts` is the one place that reads them (`readStockForPurchasing`,
`readSalesRecordsForPurchasing`, `readReservationsForPurchasing`, `readBranchNames`,
`bumpInventoryRevision`). When the Inventory area moves, swap those functions; nothing else
changes. Transit shipments (`InventoryTransitShipment`, `InventoryTransitEvent`) are read and
written directly by `data.ts` and the receiving-date route, untouched.

On Postgres a unit of work is a MongoDB **snapshot session** (for those reads, and the
receiving-date write) around one **Postgres transaction** (Purchasing's own rows). After a
Postgres write commits, the inventory revision is bumped once (`bumpInventoryRevision`); on
MongoDB it is bumped inside the write's transaction as before. A refused write bumps nothing.

## Races (`purchasing.concurrency.test.ts`, real Postgres)

- **Locks.** A lock is a row whose primary key is the stock line, inserted in the same
  transaction as its draft. Two drafts taking one line: one commits, the other's insert fails
  with a duplicate (reported as MongoDB's code 11000, which `handle` answers 409) and its
  draft rolls back whole.
- **A draft changes** (approve / cancel / link) through one conditional `UPDATE … WHERE id
  AND version AND status`; the history line is written only by the winner. Linking a PO line
  already linked by another draft fails on the link's primary key and rolls the change back.
- **A scope saves** only at the version it read (`SELECT … FOR UPDATE` on id + version); a
  second saver at the same version sees no row → 409. A save with no `version` never matches,
  as MongoDB's `{ __v: undefined }` never did.

Run it: `createdb es_race && PG_RACE_URL=postgres://localhost:5432/es_race npx vitest run
src/db/purchasing/purchasing.concurrency.test.ts` (skipped without `PG_RACE_URL`; it empties
the Purchasing tables).

## Intended differences

- **Pending drafts across the cutover.** A draft's saved `fingerprint` was hashed from the
  MongoDB scope record. After the switch the plan hashes the Postgres-built scope; where that
  isn't byte-identical (e.g. a scope saved before `cohortRevision` was always written), a
  *pending* (draft / approved) draft fails Approve / Export with "Planning inputs changed;
  cancel and recreate". Approve or cancel pending drafts before the cutover.
- A scope list ties on `name` break by id (MongoDB's order was arbitrary).
- The inventory revision moves after the commit instead of before the write.

## Verified

- `purchasing.parity.test.ts` (13 cases through the real router; every request on both
  databases, answers compared, then `t.differences()` = the copy's own check of every table).
- `purchasing.concurrency.test.ts` on a local PostgreSQL 17 (5 races).

## Cutover (not done)

Pause Purchasing writes → copy scope `purchasing` → verify → `DB_PURCHASING=postgres` → unpause.
