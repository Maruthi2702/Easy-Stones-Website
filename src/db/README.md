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

## The data layer and the switch (2026-11-10)

Routes read an area through `src/db/<area>/index.ts`, which asks MongoDB (`mongo.ts`, the
queries the routes used to run inline, moved unchanged) or Postgres (`postgres.ts`) by the
area's switch: `DB_CUSTOMERS=postgres` on the server (`appDb.ts`; anything else or nothing
is MongoDB, so a deploy changes nothing until it's set). The start-up log names the areas
on Postgres. Postgres responses keep MongoDB's shape (`customers/customerDoc.ts`), so no
screen changes.

**While MongoDB is still the database the app writes, an area is switched on the live
server only at its cutover** — before that Postgres holds only what the last copy put
there. Try it on a copy: `DATABASE_URL=pglite:<folder>` after a `pg-copy.ts --write`, or a
local Postgres.

Every read is checked twice:

- `customers/customers.parity.test.ts` (in `npm test`): the same records in an in-memory
  MongoDB and, through the real copy, in PGlite; each read asked of both.
- `npm run pg:compare` (`scripts/pg-compare.ts`): live MongoDB, **read only**, copied into
  PGlite in memory, each read asked of both, differences printed. Exit 0 = the same apart
  from the known differences below. A new read goes into `mongo.ts`, `postgres.ts`, the
  parity test and this script together.

Customer area so far: the dropdown (`GET /api/customers/dropdown`), the cities list
(`/cities`), `GET /api/customers` (newest first, paged, searched), saved-view counts
(`GET /api/customers/view-counts` and `/api/partners/view-counts`), and the Customers page
list (`GET /api/customers/list` and its `/api/partners` alias: every filter, saved view,
A–Z, Moda, sort, page, export and the basic card; SQL in `customers/listSql.ts`). The list
has its own parity test, `customers/customerList.parity.test.ts`, which also calls the real
route (sign-in, permissions, export) on both databases. `pg:compare` checks the read
responses and exact list order against the live source. On live data 2026-11-10 (78 reads):
all 21 saved-view count reads the same, every list sort in exactly the same order; the
only differences besides the known ones below came from one customer edited while the
run was going (its contact name, and the search results it moved between).

Saved-view counts use the original MongoDB tab predicate and count queries, or a single
SQL statement sharing the list's saved-view predicates. Only `tab`, the authenticated
owner and the server's Pacific day affect the badges; unrelated list filters are ignored.
Authentication and Full profile checks stay in the route, including `{}` for a basic
viewer. `customers/viewCounts.parity.test.ts` checks the six numeric keys, tab variants,
follow-up boundaries, empty results, badge/list consistency and both HTTP aliases.
It also pins the existing copy differences for deleted reps and invalid/missing branches
described below. Live badge-count comparisons are strict: any numeric difference fails
`pg:compare` and needs investigation before cutover. This read adds no schema migration.

**Every sort ends on the id** (MongoDB `_id`, Postgres `id collate "C"`, the same order):
customers with equal sort values (a city, a branch, a level) come in one fixed order, so a
page never repeats or skips a customer, and both databases list them identically.

**Schema changes reach RDS through the copy**: the copy Lambda applies `drizzle/`
migrations before it writes. After any change there, `pg-copy-aws.ts --deploy`, then
`--write` and `--verify`, before an area is switched on.

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
- `GET /api/customers` (the older paged list): customers imported in the same millisecond
  can come in another order there (same dates; that route has no id tie-break in MongoDB).

Rules that differ only on data live doesn't have (checked 2026-11-10):

- A customer whose rep's user record was deleted: MongoDB keeps the dangling id (not
  "Unassigned"); Postgres's foreign key blanks it, so it is Unassigned. 0 on live.
- A customer with no branch: the copy can't take it (a branch is required), so it would be
  missing on Postgres; the copy reports it. 0 on live (Mongoose fills "Seattle").

## Next

The full list, one box per route and step: [`DB_MOVE_CHECKLIST.md`](../../DB_MOVE_CHECKLIST.md).

1. The rest of the customer routes through the data layer: the profile, the map, then the
   writes (create / edit / delete / visits / resources / contacts) — writes need the
   cutover plan, since MongoDB stays the database written until then.
2. The other areas that point at customers — deliveries, payments, holds, lost sales,
   card expenses, the SPS import — get `customer_id` foreign keys when they move.
