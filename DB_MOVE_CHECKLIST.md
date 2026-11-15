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

## Plan: from here to the customer cutover (drafted 2026-11-11, for the owner to approve)

Writes are already built one-step: every save goes through the data layer and the whole area
flips with `DB_CUSTOMERS=postgres` (src/db/customers/writes/README.md). So the write plan
below is **one short pause at cutover**, not per-route switching (per-route would mean two
databases each holding half the writes). Approving this ticks "Agree the write plan" in §2.

1. **Customer reads (§1) are complete and on main** (merged 2026-11-12, PR #2).
   All 11 items have Mongo/Postgres implementations, parity/HTTP checks and read-only
   live comparisons. Results and per-item commits:
   [`docs/db/customer-reads-report.md`](docs/db/customer-reads-report.md).
   Merged is not switched on: `DB_CUSTOMERS` stays unset until cutover.
2. **Close the start-up jobs (§2):** retire the location backfill; move marketing-email
   migration into `/api/customer/register` and calendar sync, then retire it.
3. **Prerequisites (§3), the ones that block a rehearsal:** copy users / roles / locations /
   types to Postgres on every change; write the reverse copy script (Postgres → MongoDB);
   decide `admins` / `crossoversheets`. Owner-only items (prod RDS access for Render, deploy
   prod, dev backups) can wait until just before cutover.
4. **Rehearse (§4):** run every customer screen against a copy with `DB_CUSTOMERS=postgres`;
   time the Customers page and profile (38 ms per query Render → Ohio; batch where slow).
   Fix what the rehearsal finds before any live step.
5. **Cutover, early morning:** pause customer writes → copy `--write` + `--verify` equal →
   set `DB_CUSTOMERS=postgres` on Render → open each screen → `--lock`. MongoDB customers
   stay read-only 2 weeks, with the reverse script as the way back.
6. **Then §5 area by area**, customer-linked areas first (Deliveries, Payments, Holds, Lost
   Sales, Card Receipts, SPS), Users / Roles / Locations / sign-in last.

Parallel, not database: set a real `JWT_SECRET` on Render and rotate the pasted passwords.

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
- [x] `GET /api/customers/:id` + `/:customerId/{visits,resources}/:entryId` — the profile, including nested contacts (`customerHistoryResponse`) · src/routes/customerHistory.ts — 2c73456, ebb6bd4
- [x] `customerRecordResponse` (the profile-shaped reply of create/edit; shapes the saved record using the selected database) · src/db/customers/index.ts — on main, d9a9b54
- [x] `GET /api/customers/:id/vcard` · server.ts — on main, d9a9b54
- [x] `GET /api/customers/:customerId/moda` · src/routes/customerResources.ts — on main, d9a9b54
- [x] `GET /api/customers/map`, `/map/rep-counts`, `/map/:id` — Route Planner · src/routes/customerMap.ts — on main, bb22ed8
- [x] `POST /api/customers/possible-duplicates` · server.ts — on main, bb22ed8, 677f0ec
- [x] `GET /api/dashboard/stats` — tiles and follow-up counts · server.ts — on main, 7d6639e
- [x] `GET /api/dashboard/visits` · server.ts — on main, 7d6639e
- [x] `GET /api/dashboard/followups` + `/followups/panel` · server.ts — on main, 7d6639e
- [x] `GET /api/dashboard/resources` · server.ts — on main, 7d6639e
- [x] `GET /api/schedule` + the calendar `.ics` feed (`schedules` + customer names) · src/routes/schedule.ts — on main, bb22ed8, d945d55
- [x] Customer lookups in other areas: Cart & Holds (`holds/router.ts`), Permits' "is a customer" (`permits/router.ts`), public product prices (`routes/publicProducts.ts`) — on main, d9a9b54, 677f0ec

Verified on Node 24.22.1: 3,762 tests passed (4 skipped), typecheck and health check
passed, independent review found no MongoDB behavior changes, and all 160 live read
comparisons matched with documented conversions only. No RDS writes or cutover.

## 2. Customer area: writes

These go to Postgres only at cutover (§4), because MongoDB stays the database the app
writes until then. Each still moves through the data layer first, switch off. Built 2026-11-11 by parallel agents on `feat/pg-customer-writes` (rules and test harness: `src/db/customers/writes/README.md`); on main (314c506).

- [ ] Agree the write plan with the owner: one short pause at cutover, or per-route switch-over
- [x] `POST /api/customers` — create (also `/api/sales/customers`, `/api/partners` aliases) — on main, 66a5b31
- [x] `PUT /api/customers/:id` — edit (geocoding, rep name, Moda typed values) — on main, 66a5b31
- [x] `DELETE /api/customers/:id` — delete with backup (`customer_delete_backups`) — on main, d2b7d97
- [x] `POST /api/customers/bulk-delete` + `/bulk-delete/undo` · src/routes/customerBulkDelete.ts — on main, d2b7d97
- [x] `PATCH /api/customers/bulk` · server.ts — on main, 66a5b31
- [x] `PATCH /api/customers/:id/active` · server.ts — on main, 66a5b31
- [x] `PATCH /api/customers/:id/quick-note` · server.ts — on main, 347e64b
- [x] `PUT /api/customers/:id/password` + website sign-in: `/api/customer/register`, `/login`, `/me` (`customer_logins`) · server.ts — on main, 966e5cf (+9acfc28: reset lifts the lock)
- [x] Contacts: `POST /:customerId/contacts`, `PUT /:customerId/contacts/:contactId` · server.ts — on main, 966e5cf
- [x] Partners: `POST` / `DELETE /:customerId/associations` · server.ts — on main, 966e5cf
- [x] Visits: `POST`, `PUT`, `PATCH …/follow-up` · src/routes/visits.ts — on main, 1e024e6
- [x] Visits: `DELETE /:customerId/visits/:visitId` (with its placement resource) · server.ts — on main, ac96de3
- [x] Visits: `POST …/visits/:visitId/react` · server.ts — on main, 1e024e6
- [x] Resources: `POST`, `PUT`, `DELETE` (+ Moda recount in the same save) · src/routes/customerResources.ts, src/services/modaCount.ts — on main, ac96de3
- [x] Calendar: `POST /schedule`, `/schedule/bulk`, `PUT` / `DELETE /schedule/:id`, `DELETE /schedule/route`, backfill · src/routes/schedule.ts — on main, 7737178
- [x] Activity log writes (every customer / visit / resource change) · `activity_logs` — on main, inside each save (activityLog.ts, 347e64b)
- [x] Duplicates: `/duplicates/resolve` + `/undo` (merge, `customer_merge_backups`) · src/services/customerMerge.ts — on main, 37e9a91
- [x] Excel import: `/import/preview`, `/import/apply`, `DELETE /import/memory` · server.ts — on main, 36d94dc
- [x] SPS: `/sps-connect/*` and the SPS import runs (`/sps-import/*`, the runner) · src/routes/customerSps*.ts, src/services/spsImportRunner.ts — on main, 36d94dc, 4d2828c
- [x] Type lists: moving / deleting a visit or resource type rewrites customers · src/services/typeReplacement.ts, seedTypeLists.ts — on main, ac96de3
- [x] Geocoding job (fills a customer's map point) · src/services/customerGeocoding.ts — on main, 966e5cf
- [x] iCloud / Google calendar sync · src/services/icloudSyncService.ts, schedule.ts — on main, 7737178
- [x] Customer-write attribution: `getPerformerInfo` in server.ts still reads a customer name directly from MongoDB; route it through the existing customer data layer before cutover
- [ ] Start-up jobs that touch customers · server.ts — location backfill retired (done); `/api/customer/register` now sets `marketingEmail` / `receiveMarketing` itself on MongoDB and Postgres (accounts.parity test); still open: the start-up marketing-email migration in server.ts stays until cutover, then retire it (no calendar-sync customer creates customers — nothing to change there)
- [x] A user renamed → customers' rep name (gone in Postgres: it's a join) · server.ts — on main, 66a5b31

## 3. Before anything is written to RDS

- [x] Prod RDS size: db.t4g.small Multi-AZ, 20 GB growing to a 100 GB cap, 7-day backups, ~$55/mo; size up when the CPU-credit or free-memory alarm fires (owner, 2026-11-10) — aws-infra 63e962d
- [x] Prod without NAT gateways, master-password rotation off (~$65/mo saved) — aws-infra 9e29b41
- [x] Prod in the same AWS account as dev; its $150 budget covers the account — aws-infra 4f36c4c
- [x] Prod RDS lets the website on Render in (`database.publicAccess`, Render's 2 Virginia ranges, as dev) — aws-infra feat/prod-render-access; prod deployed 2026-11-12 (db `easy-surfaces-prod-db.cjukgckwuvzb.us-east-2.rds.amazonaws.com`; prod API / front end / CI stacks left off). Render's `DATABASE_URL` now points at it; `npm run pg:ping` from Render: connected, 12 ms per query, 111 tables, 4,506 customers (2026-11-12)
- [x] Deploy prod (owner ran it 2026-11-12); dev's $10 budget turned off by `make deploy ENV=dev` (owner, 2026-11-12)
- [x] Dev RDS: backups raised to 7 days and dev's $10 budget off (aws-infra `make deploy ENV=dev`, 2026-11-12). Not done on purpose: dev's delete-on-teardown (`removalPolicy: destroy` is shared with dev's buckets); dev holds only test copies
- [ ] Tables for the 2 collections not copied yet (`admins`, `crossoversheets`), or confirm they stay empty
- [x] Users, roles, locations, visit / resource types copied MongoDB → Postgres on every change until they move (customers point at them) · src/db/reference/ (change stream + 10-minute safety net, started with `DB_CUSTOMERS=postgres`) — tested; not yet run against RDS
- [x] A reverse copy script (Postgres → MongoDB) for going back during the 2 weeks after cutover · scripts/pg-reverse.ts, src/db/reverse/ — round trip proved on the live copy 2026-11-12 (README lists the few spellings that differ); run on Render from prod RDS into a scratch database on Atlas 2026-11-12 with `pg-reverse-check.ts`: every live document rebuilt, only the known spellings differ
- [x] Speed: 38 ms per query Render (Virginia) → RDS (Ohio). Counted 2026-11-12 ([docs/db/customer-query-counts.md](docs/db/customer-query-counts.md)): every screen ≤ 6 queries (≈ 0.3 s at most); saves 6–22, delete customer 40 (≈ 1.6 s). Real RDS: 12 ms per query, so ≈ 0.1 s per screen and ≤ 0.5 s per save (docs/db/customer-query-counts.md)

## 4. Customer area cutover

- [x] RDS schema up to date (prod, 2026-11-12): `pg-copy-aws.ts --deploy` after any change in `drizzle/` (the copy applies migrations; this read batch adds 0010 calendar clocks and 0011 customer matching order)
- [x] Rehearse on a copy: every customer screen opened with `DB_CUSTOMERS=postgres` (local, PGlite or local Postgres) — API level 2026-11-12 ([docs/db/customer-rehearsal.md](docs/db/customer-rehearsal.md)) and owner's browser click-through 2026-11-12: all screens working; the 2026-01-28 resource's time zone to be checked by the owner
- [x] Pause customer writes (2026-11-12, ~9:50 PM Pacific, `CUSTOMER_WRITES_PAUSED`; about 30 minutes in all)
- [x] `pg-copy-aws.ts --write`, then `--verify --scope customers`: equal (the first verify showed ~2,600 `matchOrder` differences, cause not found; two re-runs were clean)
- [x] Set `DB_CUSTOMERS=postgres` on Render; opened each customer screen live; `ZZ Cutover Test` created, edited, deleted, nothing in MongoDB (2026-11-12)
- [x] `--lock "cutover 2026-11-12"` the copy so it can never overwrite live Postgres data
- [ ] MongoDB customers kept read-only for 2 weeks; then removed

## 5. The other areas, one module at a time (each: data layer → parity → cutover, as above)

Redrafted 2026-11-12 (owner: "by each module"). One cutover per module, in an order where
a module moves after the ones it reads. Only the tiny ones share a cutover. The order is my
reading of the code: re-check each module's reads before starting it. Rough build time in
brackets; Mongo's 2-week read-only soak for one module overlaps the build of the next.

- [ ] **Operations batch, one build and one cutover** (owner, 2026-11-12: "in 1 go"; about 9–11 days one after another, 4–5 with parallel agents). Daily Reports derives from the other three, so moving them together removes the half-and-half period. Each keeps its own switch (`DB_DELIVERIES`, `DB_PAYMENTS`, `DB_CHECKIN`, `DB_DAILY_REPORTS`) and all four flip in the same early-morning window; Daily Reports is verified last.
  - [x] Deliveries + Delivery Schedule (3–4 days; gets `customer_id` foreign keys). Data layer `src/db/deliveries/` (switch `DB_DELIVERIES`); routes keep their MongoDB filters and `filter.ts` turns them into SQL.
    - [x] Reads: `GET /api/deliveries` (board week, Pending, Cancelled, a branch's view of a transfer), `/search`, `/:id` — parity test through the real router
    - [x] Reads: trucks; the board's runs and the startup renumber; driver orders (server.ts); Daily Reports' three delivery reads; Accounting's freight sync (through `freightDeliveries`). `delivery-columns` stays with Locations (that area moves last)
    - [x] Writes: save (POST + ePOD), status, assignment, order, receiving, arrivals, receive, delete, clear ePOD, trucks, driver "move to Pending"; stop renumbering. A Postgres save builds the ticket as MongoDB would hold it, then the copy's own `deliveryRowOf` makes the row — parity test `deliveries.writes.parity.test.ts` (13 cases)
    - [x] Read-only comparison on live data (`scripts/pg-compare-deliveries.ts`, 2026-11-13): 1,779 requests (every branch login, an admin, Pending, Cancelled, search, each ticket by id, trucks) — only the documented differences in `src/db/deliveries/README.md`; no ticket has a branch that isn't a location
    - [x] Browser click-through on a local copy with `DB_DELIVERIES=postgres` (owner, 2026-11-13): everything looked fine. Not covered: real ePOD signature images and packing-list files (file store off locally)
    - [x] Packing-list upload route has no database write of its own (checked); nothing else left in this module
    - [x] **Cutover done 2026-11-13** (deliveries on their own, ahead of the rest of the batch): `DELIVERIES_WRITES_PAUSED` on, `pg-copy-aws.ts --scope deliveries --write` then `--verify` into prod (1,148 tickets, 0 trucks, equal), `DB_DELIVERIES=postgres` on Render, `--lock … --scope deliveries` (28de283). Owner confirmed a saved ticket sticks. Never run the scoped copy again. Mongo deliveries kept read-only for 2 weeks; then removed. Daily Reports still read them through the data layer until Payments / Check-In / Daily Reports move.
  - [x] Payments: data layer `src/db/payments/` (switch `DB_PAYMENTS`); the route and the Daily Report's payment read go through it; parity test `payments.parity.test.ts` (7 cases, the copy's own `paymentRowsOf` as the spec) — 001bf55. Intended difference: a payment whose customer isn't a customer keeps no link on Postgres. The Daily Report's submitted-day lock read MongoDB's DailyReport until Daily Reports got its layer (2026-11-13, `DB_DAILY_REPORTS`).
    - [x] Read-only comparison on live data (`scripts/pg-compare-payments.ts`, 2026-11-13): 83 requests (101 payments, 24 branch-days: list and summary per branch-day, all-branches list per day) — 0 differences
    - [ ] Local click-through with `DB_PAYMENTS=postgres`
  - [ ] Check In + Selection Sheet (2 days). Data layer `src/db/checkins/` (switch `DB_CHECKIN`; the Selection Sheet is the check-in's own fields); the routes and the Daily Report's visitor count go through it; parity test `checkins.parity.test.ts` (21 cases through the real router; `checkInRowsOf` is the spec)
    - [x] Read-only comparison on live data (`scripts/pg-compare-checkins.ts`, 2026-11-13): 1,707 requests (540 check-ins, 3 branches: log, pages, months, searches, lookups, each by id, PDF) — 0 differences
    - [ ] Local click-through with `DB_CHECKIN=postgres` (owner)
    - [ ] `CHECKIN_WRITES_PAUSED` for the cutover window
  - [ ] Daily Reports (3–4 days; the August 2026 incident applies, re-check `applyDerived` and submit). Data layer `src/db/dailyReports/` (switch `DB_DAILY_REPORTS`); the routes, the 11:59 PM job, the submit email's log line and the Payments page's submitted-day lock go through it. `claimSubmission` and `writeDraft` are single conditional statements on Postgres too (`README.md` there). `applyDerived` / `deriveFromSystem` / `/submit` unchanged.
    - [x] Parity test `dailyReports.parity.test.ts` (15 cases through the real router + the job; `dailyReportRowsOf` is the spec) — includes two Submits at once, an autosave after a submit, Reopen, a transfer logged on arrival to submitted days, the 11:59 job (a reopened old day too, an unopened day filed)
    - [x] Races on a real Postgres (`dailyReports.concurrency.test.ts`, `PG_RACE_URL`): 10 simultaneous Submits → 1 winner and 1 log line; autosaves racing a Submit never un-submit; first save from 8 tabs → 1 report; 12 simultaneous log lines → 12 positions; one transfer arriving twice → added once
    - [x] Read-only comparison on live data (`scripts/pg-compare-daily-reports.ts`, 2026-11-13): 575 requests (all 139 saved days with their derived figures, logs, PDFs, 4 months × branches list + CSV, overviews, submitted-days, the Payments lock reads) — 0 differences
    - [x] The Payments page's lock now reads through this layer (it moves with `DB_DAILY_REPORTS`; the two switches flip in the same window)
    - [ ] Local click-through with `DB_DAILY_REPORTS=postgres` (owner): open a day, type, Submit, Reopen, View Log, month view + Excel/PDF; Payments on a submitted day says locked
    - [x] `DAILY_REPORTS_WRITES_PAUSED` for the cutover window (2026-11-13, `src/utils/dailyReportsWritesPause.ts`, tested): report writes and `POST /api/deliveries/arrivals` answer 503, the 11:59 PM pass reads and writes nothing (it catches up on the first tick after); `/api/health` shows `dailyReportsWritesPaused` and `dailyReportsOn`
    - [x] All three together (`src/db/operationsTogether.parity.test.ts`, 8 cases: Payments + Check In + Daily Reports on Postgres at once, rows of all three checked against the copy) and `TOGETHER=1 node --env-file=.env scripts/pg-compare-daily-reports.ts` on live data — 575 requests, 0 differences
    - [ ] Verified last in the rehearsal: Daily Reports derives from the other three, so it is checked after they are on Postgres
  - [x] The operations copy (2026-11-14): `pg-copy-aws.ts --scope operations` with `--write` / `--verify` / `--lock` — only the eight tables of Payments, Check In + Selection Sheet and Daily Reports, customers linked to the live Postgres ones; tested in `src/db/copy/areaCopy.test.ts`. `DAILY_REPORTS_WRITES_PAUSED` now also holds Payments and Check In writes (one window). **Needs `pg-copy-aws.ts --deploy` once before the first real run** (uploads the copy Lambda's new code).
  - [x] **Cutover done 2026-11-14** (Payments, Check In + Selection Sheet and Daily Reports together, after a short first switch of `DB_DAILY_REPORTS` on 2026-11-13 that was reverted — see the note below): `DAILY_REPORTS_WRITES_PAUSED` on (503 on all three confirmed), `pg-copy-aws.ts --scope operations --write` then `--verify` (101 payments, 546 check-ins, 142 reports, 54 log lines — equal), the three `DB_*` = postgres on Render, pause off, `--lock … --scope operations`. Postgres then held a payment and a check-in MongoDB doesn't: new saves. Never run the operations copy again. Mongo kept read-only for 2 weeks; then removed. Owner's local click-through only exercised Daily Report saving (no payment / check-in / Submit rows were recorded locally); those paths rest on the parity tests, the live-data comparisons and the real use since.
  - Note: `DB_DAILY_REPORTS=postgres` was set on Render before its copy (2026-11-13, owner's choice) and reverted ~07:45 UTC 2026-11-14; MongoDB-only reports from before and a one-hour window of Postgres-only saves were never checked (the Render-shell query to list them was offered and not run); the cutover copy then replaced Postgres from MongoDB.
  - [x] (the plan that was followed) Rehearse all four together, then the cutover (order: pause on → `--scope operations --write` → `--verify` empty → `DB_PAYMENTS`, `DB_CHECKIN`, `DB_DAILY_REPORTS` = postgres → pause off → `--lock … --scope operations`)
- [x] Lost Sales (1 day) — **cutover done 2026-11-14**. Data layer `src/db/lostSales/` (switch `DB_LOST_SALES`); the four routes moved out of server.ts into `src/routes/lostSales.ts` (unchanged) and read / write through it. A Postgres save builds the record as MongoDB would hold it (same defaults, trimmed names, required names, reason list, Mongoose's error wording), then makes the row with the copy's own `lostSaleRowOf` (lifted out of `miscRows.ts`).
  - [x] Parity test `lostSales.parity.test.ts` (8 cases through the real router; every request on MongoDB then Postgres, rows compared with what the copy makes of MongoDB): branch scoping incl. a record with no branch, totals worked out, edit keeps what the form doesn't send, other branch reads as missing, 403 / 404 / 500 paths. Intended difference (as Payments): a customer id that isn't a customer keeps no link on Postgres.
  - [x] Own copy scope: `pg-copy-aws.ts --scope lost_sales` with `--write` / `--verify` / `--lock` (only the `lost_sales` table; links to the customers **in Postgres**); the scope names now come from `COPY_AREAS` (`isCopyArea`), tested in `areaCopy.test.ts`. **Needs `pg-copy-aws.ts --deploy` once before the first real run** (uploads the copy Lambda's new code).
  - [x] Write pause `LOST_SALES_WRITES_PAUSED=true` (`src/utils/lostSalesWritesPause.ts`, tested); `/api/health` shows `lostSalesOn` and `lostSalesWritesPaused`
  - [x] `scripts/pg-compare-lost-sales.ts` written (admin, each branch, a branch-less login, record by record) — run on live data 2026-11-14: 6 records, 3 requests, 0 differences
  - [x] Run the comparison on live data
  - [ ] Click-through on live Postgres (owner, **pending**): add, edit, delete a lost sale; filters and totals on the Lost Sales page. `DB_LOST_SALES=postgres` was set on Render while paused (the pause was still on during the first test, so writes were not exercised)
  - [x] **Cutover done 2026-11-14**: pause on, `--scope lost_sales --write` then `--verify` (6 lost sales, equal), `DB_LOST_SALES=postgres`, pause off (`/api/health` confirmed), `--lock "Krish" --scope lost_sales`. Never run the Lost Sales copy again. Mongo `lostsales` kept read-only for 2 weeks (until 2026-11-28). Plan followed: pause on → `--scope lost_sales --write` → `--verify` → `DB_LOST_SALES=postgres` on Render → pause off → `--lock … --scope lost_sales`; then Mongo `lostsales` kept read-only for 2 weeks
- [x] Credit Card Receipts (1–2 days) — **cutover done 2026-11-14**. Data layer `src/db/cardReceipts/` (switch `DB_CARD_RECEIPTS`, README there), on `feat/card-receipts-pg`
  - [x] Routes go through the layer; parity test `cardReceipts.parity.test.ts` (16 cases through the real router + the copy's own check of every table); the copy's row builders pulled out (`companyCardRowOf`, `receiptCategoryRowOf`, `cardExpenseRowsOf`)
  - [x] Read-only comparison on live data (`scripts/pg-compare-card-receipts.ts`, 2026-11-14): 6 requests (2 expenses, 1 card in live so far), 0 differences
  - [x] `CARD_RECEIPTS_WRITES_PAUSED` (503 on its writes, on `/api/health`); scoped copy `--scope card_receipts` (`COPY_AREAS`, tested)
  - [x] On main (d0dfdc5); `pg-copy-aws.ts --deploy` run 2026-11-14 (`PG_COPY_ENV=prod`)
  - [ ] Click-through on live Postgres (owner, **pending**): the 2 existing expenses show, save and edit a test expense
  - [x] **Cutover done 2026-11-14**: pause on, `--scope card_receipts --write` then `--verify` (1 card, 6 categories, 2 expenses, 3 history lines, equal), `DB_CARD_RECEIPTS=postgres`, pause off (`/api/health` confirmed), `--lock "Krish" --scope card_receipts`. Never run the Card Receipts copy again. Mongo card collections kept read-only for 2 weeks (until 2026-11-28). Plan followed: pause on → `--scope card_receipts --write` → `--verify` → `DB_CARD_RECEIPTS=postgres` → pause off → `--lock … --scope card_receipts`
- [x] SPS import: no cutover of its own. Runs and items are in the customers data layer (`src/db/customers/writes/sps.ts`) and moved with `DB_CUSTOMERS=postgres` on 2026-11-12. Parity tests pass; read-only comparison on live data (`scripts/pg-compare-sps.ts`, 2026-11-14): 182 requests (history, all 15 runs, reports, items per result, customer ids as a set — MongoDB's order there is its index's) — 0 differences. **Not yet done:** a real import on Postgres (Start → check → Undo with one test customer); the newest live run is from 2026-11-08, before the switch
- [ ] Inventory + In-transit + Purchasing (3–4 days; stock imports use a transaction) — **built 2026-11-14 on `feat/pg-inventory`, not merged, not cut over.** ONE switch, `DB_INVENTORY`, covers all three (owner: "keep 1 switch"; `DB_INVENTORY_TRANSIT` / `DB_PURCHASING` read it too, `src/db/appDb.ts`). Data layers `src/db/inventory/`, `src/db/inventoryTransit/`, `src/db/purchasing/` (README in each); one parity test per layer plus `inventoryTogether.parity.test.ts` for where they meet.
  - [x] Stock, sales, stock import (one transaction), Inventory Analysis routes, transit import and list, Purchasing scopes / drafts / locks / PO links (locks and approvals race-tested on real Postgres)
  - [x] Where they meet: Purchasing's stock / sales / transit reads and its receiving-date confirmation go through the layers and join its own Postgres transaction; Holds' slab lookups (`findSlabsByKeys`, `findSlabByBarcode`) and Supplier POs' "Fill from SPS" read through the layers; the one revision counter (`inventoryTransaction.ts`) is read and bumped in Postgres while the switch is on, including by Holds' MongoDB transactions; the sales import re-keys Purchasing scopes inside the replacement's own transaction (`rekeyScopeCohorts`)
  - [x] Own copy scope `pg-copy-aws.ts --scope inventory` (`--write` / `--verify` / `--lock`; 18 tables, tested in `areaCopy.test.ts`) and write pause `INVENTORY_WRITES_PAUSED=true` (503 on `/api/inventory-analysis` and `/api/purchasing` writes; `/api/health` shows `inventoryOn`, `inventoryWritesPaused`; tested). **Needs `pg-copy-aws.ts --deploy` once before the first real run.**
  - [ ] Merge to main (smoke-test first, verify-before-main)
  - [ ] Read-only comparison on live data (`scripts/pg-compare-inventory.ts` — not written yet): summary, items, groups, velocity, in-transit, every Purchasing read per branch login
  - [ ] Time one stock import of ~11k rows on a local Postgres (batches of 1,000 rows; never timed)
  - [ ] Before cutover: approve or cancel every pending / approved Purchasing draft (its saved fingerprint can fail with "Planning inputs changed" after the switch)
  - [ ] Local click-through with `DB_INVENTORY=postgres` (owner): Inventory Analysis, a stock import, a sales import, in-transit, Purchasing (scope, draft, approve, receiving date), a hold on a slab, Supplier POs "Fill from SPS"
  - [ ] Cutover: `INVENTORY_WRITES_PAUSED=true` → `--scope inventory --write` → `--verify` → `DB_INVENTORY=postgres` on Render → pause off → `--lock … --scope inventory`; then Mongo inventory + purchasing collections kept read-only for 2 weeks
  - Known: Holds' reservations (`SlabReservation`) still read MongoDB until Cart & Holds moves; the per-agent intended differences are in each layer's README
- [ ] Cart & Holds (1–2 days; after Inventory, since holds lock slabs in `InventoryItems`)
- [ ] Suppliers + supplier portal (2 days; after Inventory, since POs fill from transit shipments)
- [ ] Accounting + Fuel Man (3–4 days; transactions)
- [ ] Logs, backups, settings, imports (1–2 days)
- [ ] One cutover for the tiny ones: Permits (already on Lambda), Team Files, products, colours, crossovers, contact form (1–2 days)
- [ ] Last: Users, Roles, Locations, sign-in, who's online (3–5 days; every request reads them)

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
