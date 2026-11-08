# Postgres (AWS RDS)

The move from MongoDB (Atlas, AWS Mumbai) to **PostgreSQL on AWS RDS** (no Aurora),
owner's calls 2026-11-08. The plan and its order are in `MIGRATION_NOTES.md` §3.
First area: **customers and everything linked to a customer**.

## How the two databases run side by side

- **MongoDB stays the live database** until AWS is tested. The app keeps reading and
  writing it; nothing writes to both.
- Postgres is filled by a **copy** (`scripts/pg-copy-customers.ts`): MongoDB is only
  read, Postgres is emptied and refilled in one transaction, so a re-run gives the same
  result. `--verify` compares every table, row and column.
- **Cutover**: pause writes, copy once more, verify, switch the app to Postgres, then
  `--lock "<name>"`. A locked database refuses every copy (`mongo_copy_state`), so the
  copy can never overwrite live Postgres data. MongoDB is disconnected after that.

```
node scripts/pg-copy-customers.ts                 # dry run: map + report, writes nothing
node scripts/pg-copy-customers.ts --write --report report.json
node scripts/pg-copy-customers.ts --verify
```

`MONGO_URI` is the source; `DATABASE_URL` the target — `postgres://…?sslmode=require`
for RDS, or `pglite:<folder>` for a local try-out (PGlite is Postgres inside Node, a dev
dependency; the tests use `pglite:memory`).

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

## Next

1. The customer routes read and write Postgres through a data layer (`src/db/…`),
   behind a switch, still copying from MongoDB until cutover.
2. The other areas that point at customers — deliveries, payments, holds, lost sales,
   card expenses, the SPS import — get `customer_id` foreign keys when they move.
