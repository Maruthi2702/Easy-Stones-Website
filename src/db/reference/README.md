# Users, roles, locations and type lists: Postgres follows MongoDB

Customers in Postgres point at these by id (rep, branch, visit and resource types), but they
stay on MongoDB until their own area moves (DB_MOVE_CHECKLIST.md §5, last). So once
`DB_CUSTOMERS=postgres`, every change made to them in MongoDB must reach Postgres.

- `syncReference.ts` brings the eight reference tables (locations, roles, users, user_locations,
  location_report_recipients, visit_types, resource_families, resource_types) up to date **in place**
  in one transaction, using the copy's own row builders (`copy/referenceRows.ts`). Rows added or
  changed are upserted; rows gone from MongoDB are deleted (a customer's rep then becomes none, as
  the copy blanks a link to a missing user). A row another table still needs (a calendar entry's rep,
  a delivery's driver) can't be deleted: it is kept, logged ("Reference sync kept rows…") and tried
  again next time.
- `referenceSync.ts` runs it at start-up, on every change (a MongoDB change stream on those six
  collections: model saves, scripts and the shell all count), and every 10 minutes as a safety net.
  Started from `server.ts` only when an area is on Postgres. A failed run retries in 30 seconds.
- **Lag:** a change reaches Postgres in about a second. A rep added in Users & Roles and picked on a
  customer within that second would be refused (no such user yet); the retry on the next screen works.
- Tests: `referenceSync.test.ts` — after every kind of change Postgres equals what a fresh whole copy
  would make (`verifyCopy`), including removals, a removed-and-re-added username and a kept row.
- The whole-database copy (`pg-copy`) still does the same job before cutover, and `--lock` ends it.
