# Postgres (AWS RDS)

The move from MongoDB (Atlas, AWS Mumbai) to **PostgreSQL on AWS RDS** (no Aurora),
owner's calls 2026-11-08. The plan and its order are in `MIGRATION_NOTES.md` §3.
First area: **customers and everything linked to a customer**; since 2026-11-09 **every
other area too** — 74 of MongoDB's 76 collections (the other two are empty and unused,
`NOT_COPIED` in `copy/readMongo.ts`). A collection with records the copy doesn't know
stops the copy, so nothing a new feature adds can be left behind.

## How the two databases run side by side

- **MongoDB stays the live database** until AWS is tested. The app keeps reading and
  writing it; nothing writes to both.
- Postgres is filled by a **copy** (`scripts/pg-copy.ts`): MongoDB is only
  read, Postgres is emptied and refilled in one transaction, so a re-run gives the same
  result. `--verify` compares every table, row and column.
- **Cutover**: pause writes, copy once more, verify, switch the app to Postgres, then
  `--lock "<name>"`. A locked database refuses every copy (`mongo_copy_state`), so the
  copy can never overwrite live Postgres data. MongoDB is disconnected after that.

```
node scripts/pg-copy.ts                 # dry run: map + report, writes nothing
node scripts/pg-copy.ts --write --report report.json
node scripts/pg-copy.ts --verify
```

`MONGO_URI` is the source; `DATABASE_URL` the target — `postgres://…?sslmode=require`
for RDS, or `pglite:<folder>` for a local try-out (PGlite is Postgres inside Node, a dev
dependency; the tests use `pglite:memory`).

### Copying into RDS on AWS

RDS sits in the VPC's isolated subnets: no laptop, NAT or EC2 reaches it (owner: no EC2).
`scripts/pg-copy-aws.ts` takes the same flags and does the run in two halves:

```
laptop ── reads MongoDB ──► snapshot (Extended JSON, gzipped) in the copy bucket
laptop ── invokes ──► easy-surfaces-<env>-db-copy (Lambda in the VPC)
                       ├─ reads the snapshot (S3 gateway endpoint)
                       ├─ writes / checks Postgres as app_iam (IAM token, no password)
                       └─ writes the report to the bucket
laptop ── deletes the snapshot (the bucket forgets anything left after a day)
```

```
node scripts/pg-copy-aws.ts --deploy              # upload the Lambda's code (after any change in src/db)
node scripts/pg-copy-aws.ts                       # dry run
node scripts/pg-copy-aws.ts --write --report report.json
node scripts/pg-copy-aws.ts --verify
```

`MONGO_URI` is the source; AWS credentials are the default profile; `PG_COPY_ENV`
(dev by default) picks the function. The function, its bucket and permissions are in
aws-infra (`lib/constructs/mongo-copy.ts`); its code is `aws/copyHandler.ts`, uploaded by
`--deploy` (CloudFormation leaves uploaded code alone). The snapshot format is
`aws/snapshot.ts` (tested: a round trip copies the same as reading MongoDB).

## Tables (drizzle schema in `schema/`, SQL in `/drizzle`)

Each record keeps its MongoDB id (24 hex characters) as its primary key, so links,
saved filters and socket messages keep working. Every link is a foreign key.

| Table | Key | Links |
|---|---|---|
| `locations` | id (`name` unique) | + `time_zone` (from `src/config/branches.ts`) |
| `roles` | id (`name` unique) | |
| `users` | id | `role` → roles.name, `home_location_id`; `user_locations`; `all_locations` = '*' |
| `visit_types`, `resource_families`, `resource_types` | id (`name` unique) | resource_types.family → families.name |
| `customers` | id | `location_id`, `sales_rep_id`, `created_by_id` |
| `customer_logins` | customer_id | the website password / sign-in lock, apart from sales data |
| `customer_contacts` | id | `customer_id` |
| `customer_links` | customer + kind + other | `associated` / `not_duplicate` |
| `visits` | **visit id** | **`customer_id`**, created / updated / done by (user or customer) |
| `visit_attachments`, `visit_reactions`, `visit_follow_up_events` | | `visit_id` |
| `resources` | id | `customer_id`, `placement_visit_id` (unique), `resource_type` |
| `resource_attachments` | | `resource_id` |
| `schedules` | id | `user_id`, `customer_id`, `visit_id` |
| `activity_logs` | id | none on purpose: history outlives what it describes |
| `customer_delete_backups`, `customer_merge_backups` | id | snapshot as MongoDB extended JSON, for Undo |

**Deleting:** contacts, the login, links and a visit's parts go with their parent.
Visits, resources and schedules don't — a customer that still has them can't be
deleted, so a delete route must back up and remove them itself, in one transaction.
A deleted user leaves customers / visits with a blank rep or author (`set null`).
A calendar entry's `customer_id` may be blank: copied from MongoDB after its customer
was deleted there (the calendar shows it with no name).

**Not stored any more** (derived by a join): `salesRepName`, a resource's copied
customer name and its `location` (blank on all 84), the visit's `resourceId` (the
resource's `placement_visit_id` is the one link). Customer `followUpDate` and
`lockUntil` were empty on every record and are gone / moved to the login.

## Every other area (2026-11-09)

One schema file and one rows file per area; `copy/plan.ts` runs them all in one
transaction (one truncate of every table, inserts parents first), and the check keys
each table on its own primary key.

| Area | Schema | Tables |
|---|---|---|
| Operations | `schema/operations.ts` | `deliveries` (ticket id `del_…` kept as `ticket_id`; branch and transfer destination by location id; the ePOD as `pod_*`), `trucks`, `daily_reports` + `_transfers` / `_containers` / `_log`, `payments_received` + `payment_history` |
| Check In, Cart & Holds | `schema/checkInsHolds.ts` | `office_check_ins` + `check_in_selections`, `sales_carts` + lines, `sales_holds` + lines, `sales_slab_reservations`, `sales_counters`, `sales_hold_history` |
| Inventory | `schema/inventory.ts` | `inventory_items`, `inventory_sales_records`, `inventory_transit_shipments` + lines, transit reports / events, `inventory_revision`, the stock import's imports / backups / state |
| Purchasing | `schema/purchasing.ts` | `purchasing_scopes` + aliases / policies, `purchasing_inbound`, `purchasing_drafts` + history, locks, PO links |
| Accounting, Fuel Man | `schema/accounting.ts` | `acct_carriers`, `acct_freight_charges` + flags, `acct_carrier_invoices` + charges, `acct_payments` + charges, `acct_audit`; `acct_fuelman_*` (reports, assignments + splits, profiles, PDFs as bytea, costs, state, periods, history) |
| Card receipts, Suppliers | `schema/cardsSuppliers.ts` | `company_cards`, `receipt_categories`, `card_expenses` + history; `suppliers`, `supplier_logins`, `supplier_pos` + lines, `supplier_blocks` + `supplier_bundles`, three history tables |
| Permits | `schema/permits.ts` | `permits` + `permit_contacts`, `permit_runs`, `permit_checks`, `permit_contractors`, `permit_contractor_names` |
| The rest | `schema/misc.ts` | `lost_sales`, `products` + colours / bundles, `easy_stones_colors`, `crossover_colors` + `crossovers`, `app_settings`, `import_memories`, `contact_submissions`, `team_files`, `sales_resources`, `sps_import_runs` + items, `cloudinary_to_s3_backups`, `legacy_leads`, `legacy_sales_customers` |

Rules the areas follow (my defaults, 2026-11-09):

- **Links that must hold are foreign keys** (a delivery's customer, a payment's
  branch, a hold's customer, a bundle's block…); a dangling one is blanked and
  reported, the name stored beside it stays.
- **History and records of who did what are not**: audit lines, hold history, a
  charge's delivery (`delivery_ticket_id`), an import's customer — they outlive what
  they describe. People there are id + name as stored (the hold job acts as `system`).
- **StoneProfits' and Fuel Man's location labels stay text** — many are fabricators
  holding consigned stock or labels like "FWB", not branches.
- **Free-form fields stay jsonb** (Mixed in MongoDB: import rows, draft lines, Fuel Man's
  parsed statement, SPS plans, a supplier note with its translations). Backups meant
  for an undo keep MongoDB extended JSON (`snapshotJson`) so an undo writes back exactly.
- **Ids grow with the app, so no fixed list**: permit sources and categories, Lost Sale
  reasons, Daily Report log actions. Fixed lists the models enforce are `check`s.
- Model defaults fill a missing field as Mongoose would (e.g. `delivery_type` jobsite);
  a field with no default stays null.

Live data into PGlite on 2026-11-09: 75,057 rows, verified equal; 15 more problems than
the customer area's 387 (13 deliveries naming a customer that isn't a record, one
freight charge for a deleted ticket — kept, one Team File time saved with no zone).

## Kinds of time

- `date` — a day: a visit's day, a follow-up's due day, a resource's day.
- `timestamp` (no zone) — the **local clock times the app writes today**
  (`'2026-10-23T14:05:00.000'`), kept exactly as written.
- `timestamptz` — real moments the server stamps (`created_at`, sign-in locks).

What the copy converts, and reports: a Date in a day field at midnight UTC → that day;
a real instant in a local-time field → the clock of its branch (the customer's, or the
rep's home location for calendar entries); `Date.toString()` text → its own clock;
hour `24` (an old formatter's way of writing 00 after midnight) → 00 on that day.

## What the first copy of live data found (2026-11-08, dry run into PGlite)

4,502 customers, 553 visits, 84 resources, 91 contacts, 541 calendar entries, 930 log
entries — **verified equal**. Reported, not fixed (the Mongo clean-up waits, owner):

- 6 calendar entries for customers that no longer exist — copied with a blank
  customer (the live calendar still shows them, with no name).
- 25 visits carry a type that isn't on the Visit Types list — copied as is
  (`visit_type` has no foreign key until those names are added as hidden types).
- 1 contact with no id — given one made from its customer and place in the list
  (`contactIdFor`, the same on every run). 1 link to a deleted customer — not copied.
- 1 user's home location isn't a location; 1 visit's author is neither a user nor a
  customer — blanked.
- Visit photos saved as `/uploads/...` paths (34) point at the old server disk.

## The data layer and the switch (2026-11-11)

Routes call `src/db/customers/index.ts`. It selects the MongoDB or Postgres twin
with `DB_CUSTOMERS=postgres` (`appDb.ts`); an unset or other value stays on MongoDB.
The switch changes no production setting by itself. SQL replies retain `_id`, nested
addresses, branch names, rep names and the API's existing date strings through
`customerDoc.ts` and the nested record loaders.

**Keep the production switch off until the customer cutover.** Before the final copy,
Postgres contains the older snapshot. These reads use the existing schema; the remaining
customer read batch adds no SQL migration and makes no AWS or live database changes.

The customer reads now include the previously moved dropdown, cities, paged customers,
Customers list and saved-view counts, plus all 11 remaining read checklist items:

| Group | Relational implementation | Reads and replies |
|---|---|---|
| Profiles | `postgres.ts`, `profileSql.ts`, `customerDoc.ts` | Customer profiles, scoped visit/resource details, contacts and linked customers' last visits |
| Small customer reads | `lookup.postgres.ts` | vCards, Moda summaries, and the customer snapshots, contact matching and price tiers used by Holds, Permits and the public catalog |
| Map, duplicate checks and calendar | `mapCalendar.postgres.ts` | Slim map pins, rep counts and details; duplicate signals, separation links and matched records; schedule and calendar-feed entries |
| Dashboard | `dashboard.postgres.ts` | Visits, follow-up loading, resources and statistics rollups |

`mongo.ts` and `postgres.ts` expose the matching functions through the facade; the
small, map/calendar and dashboard groups keep their query bodies in corresponding
`.mongo.ts` / `.postgres.ts` helpers. The MongoDB query bodies are moved from the
routes without changing their predicates or projections. Authentication, validation,
Full profile access, team and map scope remain at the HTTP boundary. SQL receives the
scope already decided there and never widens it.

Profiles use `profileSql.ts` to fetch visits with their attachments, reactions and
follow-up history, resources with attachments, and contacts in saved order. History
follows its author's team, including linked customers' last visits; a customer's branch
does not widen access. Basic cards retain their allowlist.

`customerHistoryResponse` / `customerRecordResponse` shape the **actual record just
saved** for create/edit replies. The shared shape helper removes the password and
applies history scope; uploader names now come from the database selected by
`DB_CUSTOMERS`. It does not fetch an older customer snapshot to construct the reply.

Moda summaries retain the shared `modaSummary` rules: only Active resources contribute
to the totals, with the same earlier counts and resource-family lookup. Map scope and
rep filters remain in `routePlannerScope.ts`. Duplicate scoring stays in the existing
matcher, with "not a duplicate" links supplied by `customer_links`. Calendar reads
reuse the write layer's clock conversion; entries for a deleted customer still have no
customer name. The `.ics` route retains its token and output handling.

Dashboard routes keep `dashboardPeopleOf`, range decisions, the shared follow-up
selection/status/count rules, and panel selection. Their data layer loads scoped rows
and performs the existing rollups. The old "today schedule" tile still counts pending
follow-ups due today, as it did on MongoDB; it is not silently changed to a calendar
entry count. The resource copier now preserves a legacy resource's `createdBy` owner
when `uploadedBy` is null or missing, matching MongoDB's fallback and keeping scoped
resource lists and counts consistent. No numeric comparison allowance covers this fix.

### How the reads are verified

Parity suites seed in-memory MongoDB, copy through the real `copyFromMongo` into
PGlite, then compare both answers with `normalize()` from `parity.ts`. Authenticated
HTTP cases cover permitted and denied users and attempts to widen scope. The small,
map/calendar and dashboard suites also keep the existing route tests running.

`npm run pg:compare` reads live MongoDB **read only**, copies into disposable PGlite,
and checks each registered read. The main script retains the original customer-list,
count and profile comparisons, and adds group registrations from
`pg-compare-lookups.ts`, `pg-compare-map-calendar.ts`, and `pg-compare-dashboard.ts`.
It also checks mutation response shaping against the saved source record. An RDS URL
is never used as the disposable copy target by this comparison script.

Postgres text sorts use `COLLATE "C"` and an id tie-break. Existing MongoDB sorts stay
unchanged, including older endpoints that have no id tie-break. The dashboard live
comparator canonicalizes only ties proved by the source's identical `(date, createdAt)`
keys; it preserves the order between different keys and compares every returned field.
A missing row or a different chronological group order still fails. Existing list
comparisons retain their documented, narrower sort preparations.

`customers/readPreflight.ts` checks source shapes that would otherwise alter numeric
results or range membership after the copy. A customer with no saved `status` would
change the dashboard lead count; a visit/resource whose copied day differs from the
original dashboard range day would move between ranges. Either condition makes
`pg:compare` fail and blocks readiness for cutover until source cleanup or an explicit
schema decision resolves it. There are **no numeric or range-membership allowances**.
Saved-view badges and dashboard rollups must compare exactly.

Integrated live validation for the full batch is in progress. Earlier live checks on
2026-11-10 covered 78 customer/list/count reads; the current pass includes profile and
all newly implemented reads. **TODO: record the final integrated live comparison
result, source preflight result and current known-difference counts.** Per-item commits,
focused tests and remaining checks are in
[`customer-reads-report.md`](../../docs/db/customer-reads-report.md).

**Schema changes reach RDS through the copy**: the copy Lambda applies `drizzle/`
migrations before it writes. This read batch introduces no schema changes. Any future
schema change still requires the separate deployment/copy/verify procedure before an
area is switched on.

### Known differences (live data, 2026-11-10)

What `pg:compare` sets aside (`KNOWN_DIFFERENCES` in `customers/parity.ts`, and the
set-asides in its sort checks; anything else fails it):

- 27 customers saved with no createdAt / updatedAt: MongoDB lists them last on
  newest-first lists, Postgres has their real time (from the id) and lists them in place.
- 5 customers whose stored rep name is "krish" for a user now named "Krish": Postgres reads
  the user's current name (the stored copy is gone, as planned), so the Rep sort places
  them with "Krish".
- 4 customers saved with no rep name at all (not even ''): MongoDB's Rep sort puts them
  first; on Postgres they sort with the other unassigned customers.
- 6 old customers with no geocode block: Postgres says "pending" (the model's default).
- firstName / lastName (2 old records, both have a company name) and lastLoginIp (written
  on a website sign-in, read by nothing; the last of `loginIps`) aren't copied.
- 1 link to a deleted customer isn't copied.
- Profile history exposes conversions already made by the copy: 10 contact times and
  1 resource time saved as instants use their branch's clock; 21 visit update times and
  6 reaction times saved as `Date.toString()` use the clock written in that string;
  6 history/contact times written with hour `24` use `00` on the same day. Comparisons
  validate the exact converted value and source branch, including milliseconds.
- 29 visit follow-up days stored as midnight-UTC Dates become the same `YYYY-MM-DD` day.
- 2 visits with a single photo URL return a one-item array containing that exact URL.
- 23 resource customer-name copies are stale; Postgres joins the parent's current
  company/contact name. The comparator checks that name against the source parent.
- 1 visit's `createdBy` is `test_script`, not an account id: the copy blanks it and keeps
  the author name. No staff scope can include this non-account; all-history scope still
  includes the visit. Valid account ids disappearing are not allowed by this exception.
- 1 contact without an id gets the deterministic `contactIdFor(customerId, position)`
  id. 1 old contact explicitly stores `isPrimary: false`; this unused default is omitted.
- Dashboard customer labels have one exact separator conversion: when source
  `company` is explicitly `''`, MongoDB's aggregation treats that string as truthy
  and can return `" - Contact"`; Postgres's concatenation returns `"Contact"`.
  Missing/null/empty company values share the same SQL default, so their original
  presence cannot be reconstructed there. This cosmetic exception must be checked
  against the source parent and the exact expected strings; arbitrary customer-name
  differences are not allowed. **Live count: PENDING integrated comparison.** The
  dashboard parity suite pins explicit-empty and missing-company cases separately.
- `GET /api/customers` (the older paged list): customers imported in the same millisecond
  can come in another order there (same dates; that route has no id tie-break in MongoDB).

Rules that differ only on data live doesn't have (checked 2026-11-10):

- A customer whose rep's user record was deleted: MongoDB keeps the dangling id (not
  "Unassigned"); Postgres's foreign key blanks it, so it is Unassigned. 0 on live.
- A customer with no branch: the copy can't take it (a branch is required), so it would be
  missing on Postgres; the copy reports it. 0 on live (Mongoose fills "Seattle").

## Next

The full migration steps and cutover gates remain in
[`DB_MOVE_CHECKLIST.md`](../../DB_MOVE_CHECKLIST.md).

1. Complete the integrated test, typecheck, read-only live comparison and local
   MongoDB server-health verification for the customer read batch; record their
   results in [`customer-reads-report.md`](../../docs/db/customer-reads-report.md).
2. Rehearse customer screens and write/rollback workflows on a copy, measure real
   RDS performance, and resolve the remaining cutover prerequisites. Production
   stays on MongoDB until the owner authorizes its switch.
3. Move the other areas that point at customers—deliveries, payments, holds, lost
   sales, card expenses and SPS imports—through their own data layers and checks.
