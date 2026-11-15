# Supplier POs and the supplier portal on Postgres (switch `DB_SUPPLIERS`)

`src/routes/suppliers.ts` (staff), `supplierBlockEntry.ts` (Purchasing entering a block), `supplierPortal.ts`
(the supplier's side) and `src/services/supplierSession.ts` (the portal's sign-in) read and write only through
a **store** (`index.ts`): `suppliersStore()` for reads and single writes, `inSuppliersTransaction` for writes that
must land whole (a PO edit and the renames it makes on the PO's unsent blocks; a supplier made inactive and its
logins signed out). `mongo.ts` is the old Mongoose code moved behind the store; `postgres.ts` is SQL. Unset = MongoDB.

- Postgres answers in MongoDB's shape (`supplierDocs.ts`): `_id`, `__v`, `lines` inside the PO, `bundles` inside
  the block, `history` as a list, a note as `{ text, lang, translations, by, at }`.
- A save builds the record as MongoDB would hold it (the old record with the change on top), then makes its rows
  with the copy's own builders (`supplierRowsOf`, `supplierLoginRowOf`, `supplierPoRowsOf`, `supplierBlockRowsOf` in
  `src/db/copy/cardsSuppliersRows.ts`), so it writes what a re-copy of MongoDB would. A PO's lines and history, a
  block's bundles and history are rebuilt whole under the parent row's lock.
- New ids are made by the route with `newId()`, so both databases get the same one; a repeated id or PO # is
  MongoDB's duplicate-key error (code 11000) to the routes, which already answer `alreadySaved` / 409 on it.
- `suppliers.parity.test.ts` runs every route (staff and portal) on both and compares the answers and every table
  (`verifyCopy`).

## How the rules are kept

- **A stale screen can't overwrite:** `updatePo` / `updateBlock` are `UPDATE … WHERE version = __v` under a row lock
  (MongoDB: Mongoose's `optimisticConcurrency`); none matched → the route's 409 "someone else just changed this".
- **One PO per number / one login per email / one supplier per SPS name:** unique indexes, as before.
- **A password** arrives in plain in `updateLogin` and only its bcrypt hash is stored (MongoDB: the model's save hook).
- **A login's session** ends on the next request when its `sessionVersion` moves (`endSessionsOf`, a password change).

## Intended differences

- A PO's / block's list order on a tie is the id's (MongoDB: whatever it found first).
- Suppliers and logins have no version column: their saves are last-write-wins, as on MongoDB.
- A supplier's name is sorted by character code, as MongoDB does, not by the database's collation.

## Cutover

Pause (`SUPPLIERS_WRITES_PAUSED=true`: every write under `/api/suppliers` and `/api/supplier-portal` answers 503, and
the portal stops writing "last seen") → `pg-copy-aws.ts --scope suppliers --write` → `--verify` →
`DB_SUPPLIERS=postgres` → pause off → `--lock … --scope suppliers`. A supplier already signed in stays signed in
(the token and the login's id are the same on both).
