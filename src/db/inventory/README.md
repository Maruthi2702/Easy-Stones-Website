# Inventory stock and sales on Postgres (switch `DB_INVENTORY`)

`src/routes/inventoryAnalysis.ts` (summary, filters, items, grouped items, velocity, the stock
import and the sales import) and `src/services/inventoryStockImport.ts` read and write only
through `index.ts`, which picks `mongo.ts` (the old Mongoose calls, moved unchanged) or
`postgres.ts` by `DB_INVENTORY=postgres`. Unset = MongoDB.

Not in this piece: shipments in transit (`inventoryTransitImport`, the `/in-transit` and
`/import/transit/*` routes), Purchasing (`src/purchasing/*`) and Cart & Holds
(`src/holds/*`), which still read the Mongoose models directly.

- Postgres answers in MongoDB's shape (`itemDoc.ts`): `_id`, numbers as numbers.
- A Postgres write builds the records as MongoDB would hold them, then makes the rows with
  the copy's own builder (`inventoryRows`, `src/db/copy/inventoryRows.ts`).
- **The stock import is one transaction on both.** Postgres: bump `inventory_revision`, then
  `inventory_stock_state` (its row lock serialises competing imports, as MongoDB's shared state
  record does), purge backups past their expiry, back up the previous catalog in 500-item
  chunks (MongoDB extended JSON), delete, insert in batches of 1,000, write the import's row.
- **The sales import** replaces one location + period in one transaction and bumps the
  revision. Purchasing's cohort re-keying is passed in as `beforeReplace` (it gets the rows
  being replaced). On MongoDB it runs inside the session; on Postgres it runs in the
  transaction but its `PurchasingScope` write goes to MongoDB, so that one write is NOT atomic
  with the replacement until Purchasing moves too.
- Reads Cart & Holds will want when it moves, already here: `findSlabsByKeys`,
  `findSlabByBarcode`, `inventoryRevision`.

## Intended differences

- **Sums are exact.** Postgres adds `numeric`; MongoDB adds floats, so a total of many cents
  can differ in the last digits.
- **Backups of an imported catalog.** MongoDB's import stores the parser's rows as they come
  (no defaults), so its backup of that catalog lacks the fields a row never had; Postgres'
  backup holds every field with its default (`''`, `0`). A restore reads both the same.
  Fields the parser does not name are dropped by Postgres and kept by MongoDB.
- **Expired backups.** MongoDB's TTL index deletes them after seven days; Postgres removes
  them at the start of the next import (the import metadata stays, as before).
- **Order ties.** Items with the same received day, and groups with the same oldest day, are
  ordered by id / product name on Postgres (MongoDB's order for equal items is arbitrary);
  the product name sorts by byte order (`collate "C"`), as MongoDB's default does.
- **Which row `$first` takes.** A product's category / units in the grouped list and the
  Reorder view are the first slab by id (insertion order), as MongoDB's natural order gave.
- **Search** is `ILIKE` with the text escaped, as MongoDB's escaped case-insensitive regex.

## Verified

`inventory.parity.test.ts` (14 cases: every read through the real router, both imports, the
sales replacement and the slab lookups, each on both databases; `t.differences()` = the copy's
own check of every table afterwards).
