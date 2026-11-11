# MongoDB → AWS RDS Postgres: checklist

One box per step, worked top to bottom. Tick a box in the commit that does it, and note
the commit. How the move works and why: [`src/db/README.md`](src/db/README.md);
the owner's decisions: [`MIGRATION_NOTES.md`](MIGRATION_NOTES.md) §3 and §5.

**How each route moves** (the pattern from 6d02164):
1. Move its MongoDB code unchanged into `src/db/<area>/mongo.ts`.
2. Write the same read/write in `src/db/<area>/postgres.ts`, answering in MongoDB's shape.
3. Add it to the parity test (`src/db/<area>/*.parity.test.ts`) and to `scripts/pg-compare.ts`.
4. Point the route at `src/db/<area>/index.ts`.
5. `npm test`, `npm run typecheck`, `npm run pg:compare` (live data, read only): all the same.
6. Commit and push. Live doesn't change: the area's switch (`DB_<AREA>`) stays off until cutover.

---

## 0. Done

- [x] RDS Postgres in dev (Ohio), IAM sign-in, TLS — aws-infra 72e1318
- [x] Tables for every area: 110 tables, 74 of 76 collections — feat/postgres-customers 749ec0e
- [x] Copy + check into RDS (`pg-copy-aws.ts --write` / `--verify`): 75,057 rows, equal — 2026-11-09
- [x] Render reaches RDS (`npm run pg:ping`: 38 ms per query) — 89e284d
- [x] Permits API runs on Lambda (still on MongoDB) — c12cae4
- [x] Switch per area (`DB_CUSTOMERS`), customer data layer, parity test, `npm run pg:compare` — 6d02164
- [x] `GET /api/customers/dropdown` — 6d02164
- [x] `GET /api/customers/cities` — 6d02164
- [x] `GET /api/customers` (newest first, paged, search) — 6d02164

## 1. Customer area: reads

- [x] `GET /api/customers/list` — the Customers page (filters, saved views, A–Z, sorts, Moda) — ca03b24
- [x] `GET /api/customers/view-counts` — the saved-view counts — 8ecace4
- [ ] `GET /api/customers/:id` + `/:customerId/{visits,resources}/:entryId` — the profile, including nested contacts (`customerHistoryResponse`) · src/routes/customerHistory.ts
- [ ] `customerRecordResponse` (the profile-shaped reply of create/edit; always MongoDB until customer writes move) · src/db/customers/index.ts
- [ ] `GET /api/customers/:id/vcard` · server.ts
- [ ] `GET /api/customers/:customerId/moda` · src/routes/customerResources.ts
- [ ] `GET /api/customers/map`, `/map/rep-counts`, `/map/:id` — Route Planner · src/routes/customerMap.ts
- [ ] `POST /api/customers/possible-duplicates` · server.ts
- [ ] `GET /api/dashboard/stats` — tiles and follow-up counts · server.ts
- [ ] `GET /api/dashboard/visits` · server.ts
- [ ] `GET /api/dashboard/followups` + `/followups/panel` · server.ts
- [ ] `GET /api/dashboard/resources` · server.ts
- [ ] `GET /api/schedule` + the calendar `.ics` feed (`schedules` + customer names) · src/routes/schedule.ts
- [ ] Customer lookups in other areas: Cart & Holds (`holds/router.ts`), Permits' "is a customer" (`permits/router.ts`), public product prices (`routes/publicProducts.ts`)

## 2. Customer area: writes

These go to Postgres only at cutover (§4), because MongoDB stays the database the app
writes until then. Each still moves through the data layer first, switch off.

- [ ] Agree the write plan with the owner: one short pause at cutover, or per-route switch-over
- [ ] `POST /api/customers` — create (also `/api/sales/customers`, `/api/partners` aliases)
- [ ] `PUT /api/customers/:id` — edit (geocoding, rep name, Moda typed values)
- [ ] `DELETE /api/customers/:id` — delete with backup (`customer_delete_backups`)
- [ ] `POST /api/customers/bulk-delete` + `/bulk-delete/undo` · src/routes/customerBulkDelete.ts
- [ ] `PATCH /api/customers/bulk` · server.ts
- [ ] `PATCH /api/customers/:id/active` · server.ts
- [ ] `PATCH /api/customers/:id/quick-note` · server.ts
- [ ] `PUT /api/customers/:id/password` + website sign-in: `/api/customer/register`, `/login`, `/me` (`customer_logins`) · server.ts
- [ ] Contacts: `POST /:customerId/contacts`, `PUT /:customerId/contacts/:contactId` · server.ts
- [ ] Partners: `POST` / `DELETE /:customerId/associations` · server.ts
- [ ] Visits: `POST`, `PUT`, `PATCH …/follow-up` · src/routes/visits.ts
- [ ] Visits: `DELETE /:customerId/visits/:visitId` (with its placement resource) · server.ts
- [ ] Visits: `POST …/visits/:visitId/react` · server.ts
- [ ] Resources: `POST`, `PUT`, `DELETE` (+ Moda recount in the same save) · src/routes/customerResources.ts, src/services/modaCount.ts
- [ ] Calendar: `POST /schedule`, `/schedule/bulk`, `PUT` / `DELETE /schedule/:id`, `DELETE /schedule/route`, backfill · src/routes/schedule.ts
- [ ] Activity log writes (every customer / visit / resource change) · `activity_logs`
- [ ] Duplicates: `/duplicates/resolve` + `/undo` (merge, `customer_merge_backups`) · src/services/customerMerge.ts
- [ ] Excel import: `/import/preview`, `/import/apply`, `DELETE /import/memory` · server.ts
- [ ] SPS: `/sps-connect/*` and the SPS import runs (`/sps-import/*`, the runner) · src/routes/customerSps*.ts, src/services/spsImportRunner.ts
- [ ] Type lists: moving / deleting a visit or resource type rewrites customers · src/services/typeReplacement.ts, seedTypeLists.ts
- [ ] Geocoding job (fills a customer's map point) · src/services/customerGeocoding.ts
- [ ] iCloud / Google calendar sync · src/services/icloudSyncService.ts, schedule.ts
- [ ] Start-up jobs that touch customers (location backfill, marketing-email migration) — retire or move · server.ts
- [ ] A user renamed → customers' rep name (gone in Postgres: it's a join) · server.ts

## 3. Before anything is written to RDS

- [x] Prod RDS size: db.t4g.small Multi-AZ, 20 GB growing to a 100 GB cap, 7-day backups, ~$55/mo; size up when the CPU-credit or free-memory alarm fires (owner, 2026-11-10) — aws-infra 63e962d
- [x] Prod without NAT gateways, master-password rotation off (~$65/mo saved) — aws-infra 9e29b41
- [x] Prod in the same AWS account as dev; its $150 budget covers the account — aws-infra 4f36c4c
- [ ] Prod RDS lets the website on Render in (`database.publicAccess`, Render's 2 Virginia ranges, as dev) — owner: later
- [ ] Deploy prod (owner runs it), then turn dev's $10 budget off (dev.yaml `monitoring.budget.enabled: false`)
- [ ] Dev RDS: raise backups from 1 day, turn off delete-on-teardown (aws-infra)
- [ ] Tables for the 2 collections not copied yet (`admins`, `crossoversheets`), or confirm they stay empty
- [ ] Users, roles, locations, visit / resource types copied MongoDB → Postgres on every change until they move (customers point at them)
- [ ] A reverse copy script (Postgres → MongoDB) for going back during the 2 weeks after cutover
- [ ] Speed: 38 ms per query Render (Virginia) → RDS (Ohio). Check the Customers page and profile load times on Postgres; batch queries where slow

## 4. Customer area cutover

- [ ] RDS schema up to date: `pg-copy-aws.ts --deploy` after any change in `drizzle/` (the copy applies migrations)
- [ ] Rehearse on a copy: every customer screen opened with `DB_CUSTOMERS=postgres` (local, PGlite or local Postgres)
- [ ] Early morning: pause customer writes
- [ ] `pg-copy-aws.ts --write`, then `--verify`: equal
- [ ] Set `DB_CUSTOMERS=postgres` on Render; open each customer screen live
- [ ] `--lock` the copy so it can never overwrite live Postgres data
- [ ] MongoDB customers kept read-only for 2 weeks; then removed

## 5. The other areas, in order (each: data layer → parity → cutover, as above)

- [ ] Areas that point at customers: Deliveries + Delivery Schedule, Payments, Cart & Holds, Lost Sales, Credit Card Receipts, SPS import (get `customer_id` foreign keys)
- [ ] Logs, backups, settings, imports
- [ ] Accounting + Fuel Man
- [ ] Inventory + Purchasing
- [ ] Suppliers + supplier portal
- [ ] Permits (already on Lambda)
- [ ] Check In + Selection Sheet
- [ ] Daily Reports
- [ ] Team Files, products, colours, crossovers, contact form
- [ ] Last: Users, Roles, Locations, sign-in, who's online (every request reads them)

## 6. After every area has moved

- [ ] MongoDB disconnected from the app; Atlas kept read-only, then closed
- [ ] Mongoose models and `mongo.ts` files removed
- [ ] Tests moved from in-memory MongoDB to PGlite
- [ ] Mongo clean-up questions closed (the data problems the copy reported: src/db/README.md)

## Related, not the database

- [ ] **Urgent:** `JWT_SECRET` on Render is still the default — set a real one
- [ ] Rotate the passwords pasted on 2026-11-09; delete `/Users/krish/render.env`
- [ ] Email on SES (parked until easystones.com DNS access)
- [ ] Live socket updates from Lambda modules (the relay) — test with a module that sends them
