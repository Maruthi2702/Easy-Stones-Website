# Type lists data layer: Visit Types, Resource Types, Families

`index.ts` gives the router (`src/routes/typeLists.ts`) a **store** per list, and picks MongoDB (`mongo.ts` = the
router's old logic, moved unchanged) or Postgres (`postgres.ts`) by `DB_TYPES` (unset = MongoDB). Both answer in
MongoDB's shape (`_id`, `order`, `fields: { notes, outcome, followUp }`, `family`), so the screens don't change.

- **A new record's id** is made by the router (`newId()`) and handed to both stores.
- **Delete with a move** (a type records use): on Postgres the move and the delete are ONE transaction, using the
  customer area's own Postgres functions on that transaction (`replaceVisitType`, `replaceResourceType`,
  `recountForFamilyChange` in `src/db/customers/writes/resources.postgres.ts`). A family's types move one at a time,
  each recounting Moda as the families stand. A family change on a resource type recounts the customers holding it in
  the same transaction as the save. A placement the code can't tell apart still refuses (409, nothing changes).
- **Other readers moved onto the layer:** the Add / Edit resource type check (`resourceTypeByName`), the Moda family
  lookup (`familyRows`, via `modaCount.loadFamilies`), and the start-up seed, which stands down once `DB_TYPES=postgres`
  (the lists were copied whole). Customers on Postgres already read `visit_types` / `resource_types` themselves.
- **`DB_TYPES=postgres` needs `DB_CUSTOMERS=postgres`** (customers already are): a delete moves customers' records.

## Cutover (owner's go-ahead)

Like staff, an **in-place sync**, never a truncating copy (customers' visits and resources point at the lists by name).
Staff and types are independent: each scope's sync leaves the other's tables alone, so either can move first.

1. `TYPES_WRITES_PAUSED=true` on Render (`/api/health` → `typesWritesPaused`): adding, renaming, hiding, reordering
   and deleting a type or family answer 503. Reads and everything else carry on.
2. `node scripts/pg-copy-aws.ts --scope types --write`, then `--verify --scope types` → must say equal.
3. `DB_TYPES=postgres` on Render, pause off (`/api/health` → `typesOn: postgres`). From then the running reference sync
   leaves the lists alone (`syncReference(..., { types: false })`); once staff is on Postgres too it stops entirely.
4. Click-through (owner): Admin → Visit Types / Resource Types: add, rename, hide, drag to reorder, delete one nothing
   uses, delete one in use (choose where they go), change a type's family to Sample binders and see a customer's counts
   move; the Add visit / Add resource dropdowns.
5. `node scripts/pg-copy-aws.ts --lock "name" --scope types`.
6. MongoDB `visittypes`, `resourcetypes`, `resourcefamilies` read-only two weeks. **Rollback after step 3 loses what was
   written on Postgres** (no reverse sync).

Tests: `types.parity.test.ts` (the real router on MongoDB then Postgres: list, add, edit, family recount, reorder,
delete with a move, built-ins, customers' rows compared by the copy's own check), `src/routes/typeLists.test.ts` (the
MongoDB behaviour, unchanged), `referenceSync.test.ts` (the cutover syncs), `src/utils/typesWritesPause.test.ts`.
Its test must flip its own switch: `openWriteParity(seed, 'DB_TYPES')`, and a customer in the seed needs a branch
(`location`) or the copy leaves it out.
