# Customer saves through the data layer

Every route that **changes** customer-area data (customers, logins, contacts, links,
visits and their parts, resources, calendar entries, the activity log, delete / merge
backups) saves through here, so the area can switch from MongoDB to Postgres in one
step at cutover (`DB_CUSTOMERS=postgres`, src/db/appDb.ts). Until then the live app
runs the MongoDB twin only: **nothing changes for staff**.

The worked example is the quick note: `core.ts` → `core.mongo.ts` / `core.postgres.ts`,
proved by `core.parity.test.ts`, used by `PATCH /api/customers/:id/quick-note`.

## Layout: one group per file set

| File | What it holds |
| --- | --- |
| `<group>.mongo.ts` | The route's MongoDB code, moved here **unchanged** |
| `<group>.postgres.ts` | Its twin; first argument `db: Db` (may be a transaction) |
| `<group>.ts` | Picks one by `areaOn('customers')`; the only thing routes call |
| `<group>.parity.test.ts` | Proves both answer the same and leave the same data |

Groups: `core` (add / edit / delete / bulk / active / quick note), `visits`,
`resources`, `contacts` (+ partners), `logins` (website sign-in and passwords),
`schedule` (calendar + sync), `merge`, `imports` (Excel), `sps`, `typeLists`,
`geocode`. Each group adds **one line** to `../index.ts`
(`export * from './writes/<group>.ts';`), so groups built in parallel merge cleanly.

## The rules

1. **MongoDB side unchanged.** Move the code as it is, with whatever it already does
   in the same operation. The route's existing tests must still pass untouched.
2. **Postgres writes what the copy would make of MongoDB afterwards.** The copy's row
   builders are the spec: `src/db/copy/customerRows.ts` (customers, logins, contacts,
   links, visits + parts, resources + attachments) and `linkedRows.ts` (schedules,
   activity log, backups). Read the builder for every column you write.
3. **One transaction per save on Postgres:** `db.transaction(async tx => …)` around
   every table it touches, the activity-log line included (`insertActivityLog(tx, …)`
   in `activityLog.ts`; the MongoDB twin calls `logActivityMongo` where the route
   logged before). Sockets, emails, geocoding calls and calendar sync stay in the
   route, **after** the save returns.
4. **New ids come from the caller** (`newId()` in `src/db/ids.ts`), passed to the save,
   so both databases get the same id and a retried POST finds what it saved.
5. **Times:** `updatedAt` / `createdAt` that Mongoose stamps → set `new Date()` in the
   twin. Local clock strings the route writes (`getNowLocalISO()`) → stored as given.
6. **What Postgres no longer stores** (a join gives it): `salesRepName`, a resource's
   copied customer name and `location`, a visit's `resourceId` (the resource's
   `placement_visit_id` is the link). Don't write them; return them in the answer if
   the MongoDB twin returns them.
7. **Deleting:** visits, resources and calendar entries don't cascade from a customer
   (foreign keys refuse it). A delete removes / backs them up itself in the same
   transaction, as `src/db/README.md` → Deleting says.
8. **Contact ids:** a contact saved without `_id` gets `contactIdFor(customerId,
   position)` in the copy. A save that adds, removes or reorders contacts must leave
   the ids the copy would give.
9. **Users, roles, locations and the type lists stay on MongoDB** until their own
   area moves; Postgres holds a copy. A twin may read them from Postgres; it never
   writes them.
10. **Same answer, same errors.** A value MongoDB refuses (a cast error) is refused by
    the twin too. Garbage ids are stopped in the route (`isId`) for both.
11. **Reads are not in scope** (another branch moves them). If a save needs a read
    that isn't in the data layer yet, add a private helper beside the save.

## Proving it

`openWriteParity(seed)` (`writeParity.ts`): seed an in-memory MongoDB through the
models, copy it into PGlite; `t.both(() => save(…))` runs the save on each at the same
frozen moment; then

```ts
expect(normalize(postgres)).toEqual(normalize(mongo)); // same answer
expect(await t.differences()).toEqual([]);             // every table equal
```

Cover the awkward cases: blank and missing fields, a deleted rep or customer, a
retried request (same id twice), refusals, and each permission or scope rule the save
checks. A test that breaks the twin on purpose must fail (try it once).

## Safety

- The local `.env` is the **live** MongoDB. Tests use the in-memory one; never run a
  save against `.env`.
- Never write to RDS. No route is switched to Postgres before cutover.
- `npm test` and `npm run typecheck` before every commit; one branch per group.
