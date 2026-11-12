# Customer read migration report

Status: all 11 remaining read items are implemented on `feat/pg-customer-reads`.
All 11 items are implemented and verified. Node 24 checks pass; all **160 live
read comparisons** match apart from the documented copy conversions, with **0 source
preflight failures**. This branch has not changed production settings or performed cutover.

The existing profile read was already implemented in `2c73456` / `ebb6bd4`; its
checklist bookkeeping was updated separately. The table below covers the 11 items
requested in the handoff, including the profile-shaped create/edit reply.

## Per-item implementation and focused validation

Focused test counts are shared across each group, not additional tests per row.

| Item | Read or reply | Feature commit | Focused validation | MongoDB behavior |
|---|---|---|---|---|
| 1 | `customerRecordResponse`: actual saved record, selected-database uploader names and existing history scope | `d9a9b54` | Small-read suite: 15 shared tests | Preserved |
| 2 | `GET /api/customers/:id/vcard`, including saved contacts | `d9a9b54` | Small-read suite: 15 shared tests | Preserved |
| 3 | `GET /api/customers/:customerId/moda`: Active-resource totals and existing Moda rules | `d9a9b54` | Small-read suite: 15 shared tests | Preserved |
| 4 | Map pins, rep counts and customer details, narrowed by existing Route Planner scope | `bb22ed8` | 9 new parity + 41 existing map/calendar tests, 50 shared total | Preserved |
| 5 | `POST /api/customers/possible-duplicates`: existing scorer with customer signals and separation links | `bb22ed8`, `677f0ec` | Map/calendar group plus source-order regressions | Preserved |
| 6 | `GET /api/dashboard/stats`: scoped rollups and unchanged shared follow-up counts | `7d6639e` | 20 new dashboard parity + 14 existing integration tests, 34 shared total | Preserved |
| 7 | `GET /api/dashboard/visits`: scoped, ordered visit rows | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 8 | `GET /api/dashboard/followups` and `/followups/panel`: shared loader, unchanged due/status/panel rules | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 9 | `GET /api/dashboard/resources`: quantities, notes, status, customer fields and uploader names | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 10 | `GET /api/schedule`, team scope and `GET /calendar/feed/:userId.ics` | `bb22ed8`, `d945d55` for calendar compatibility | Map/calendar group plus legacy-clock regressions | Preserved |
| 11 | Customer snapshots for Holds, contact matching for Permits, and price/active lookups for the public catalog | `d9a9b54`, `677f0ec` | Small-read suite plus first-match/Undo regressions | Preserved |

All routes call `src/db/customers/index.ts`; their MongoDB and Postgres query twins
live in the corresponding lookup, map/calendar and dashboard helpers. Existing
profiles continue to use `profileSql.ts` and `customerDoc.ts`. Permission, validation,
team, People, map, follow-up and matching rules remain with their existing callers
and shared utilities. Independent read-only review found no MongoDB behavior changes
in the moved query paths.

## Differences and strict checks

- The copier now uses a legacy resource's `createdBy` when `uploadedBy` is null or
  missing. This fixes scoped resource rows/counts on Postgres; no MongoDB records or
  query predicates change. A parity test copies and checks the legacy owner.
- PostgreSQL text ordering uses `COLLATE "C"` and id tie-breaks. MongoDB sorts remain
  as written. The dashboard comparator canonicalizes only source-proven equal
  `(date, createdAt)` ties; it still rejects missing rows, changed fields and changes
  in order between different sort keys.
- Explicit source `company: ''` can produce MongoDB dashboard label `" - Contact"`
  versus PostgreSQL `"Contact"`. This exact cosmetic conversion is tested separately
  from missing company. Its allowance must use source facts and exact expected
  strings. The 2026-11-11 source audit found **0** such customers. It is documented in `src/db/README.md`; no broader
  customer-name discrepancy is accepted.
- Existing documented profile time, default and join differences remain subject to
  `KNOWN_DIFFERENCES`. Batched detail comparisons now recognize the same source-proven
  conversions as individual details; altered values, wrong IDs and unrelated nested
  fields remain failures. Source clock/default counts: **34** normalized calendar
  starts, **1** normalized end, **239** missing schedule source defaults. Feed clock
  comparisons remain strict; these counts do not waive event or range differences.
- `src/db/customers/readPreflight.ts` fails comparison readiness for a missing
  customer `status` or a copied visit/resource day that differs from the source
  dashboard's range day. These conditions require source cleanup or an explicit
  schema decision before cutover. Numeric counts and range membership have no
  allowances.
- The live comparison found three Permit name collisions whose first match depended
  on MongoDB's customer insertion order. Migration `0011_customer_match_order.sql`
  records that copied order internally; new customers and restored customers append
  through an identity sequence. Permit matching and equal-score duplicate choices
  use it. The MongoDB matcher and queries stay unchanged. Copy verification checks
  relative order rather than requiring gapless sequence numbers after deletes;
  every logical field remains an exact comparison, and an order permutation or a
  stale identity generator fails. Identity restart rolls back with a failed copy.

## Integrated validation

| Check | Result |
|---|---|
| Focused small-read suite | 15 passed |
| Focused map/calendar parity and existing route suites | 50 passed: 9 new + 41 existing |
| Focused dashboard parity and existing integration suites | 34 passed: 20 new + 14 existing |
| Customer-order fix, core saves/deletes, merge, imports and lookup HTTP | 123 passed across 6 suites; includes 6 source-order, Undo and copy-verification cases |
| Independent MongoDB-path read-only review | No MongoDB behavior changes found |
| Final integrated full test suite | Node 24.22.1: `npx vitest run --maxWorkers=2 --hookTimeout=60000 --testTimeout=15000`; **294 suites passed, 3,762 tests passed, 4 skipped** |
| Final integrated typecheck | Node 24.22.1: `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck` passed, including server import and TypeScript source audits |
| Live read-only comparison (`scripts/pg-compare.ts`) | Node 24.22.1, main-worktree `.env` supplied explicitly: **160 reads matched**, **0 unexpected differences**, **0 source preflight failures**; 78,679 rows copied into disposable PGlite |
| Server boot against in-memory MongoDB, `DB_CUSTOMERS` unset, `/api/health` | Node 24.22.1 normal server mode, jobs off: HTTP 200, connected, database ping success |
| Integration against `origin/main` | Merged `ffa6e6f` in `a38c641`; retained the new normal-calendar customer coordinates on both databases, with feed projection unchanged |

The live comparison reads MongoDB only and copies into disposable PGlite. The group
registrations are `scripts/pg-compare-lookups.ts`, `scripts/pg-compare-map-calendar.ts`
and `scripts/pg-compare-dashboard.ts`, called by `scripts/pg-compare.ts`.

## Limits and remaining owner decisions

The batch includes SQL migration `0010_schedule_legacy_clocks.sql` for original calendar
clock metadata. The final snapshot contained 34 BSON-Date starts among 585 schedules: their
legacy string-range membership and sorting must survive the relational copy. Both
start/end metadata preserve feed instants and are maintained by clock edits/syncs;
planner replacement/clearing, visit links and backfill retain the original day predicates.
Migration `0011_customer_match_order.sql` also preserves customer matching order.
Both migrations are prepared locally; neither has been applied to RDS.

No AWS infrastructure change, RDS write, live MongoDB write,
production environment change or cutover is part of this read batch. Browser screen
rehearsal, actual RDS query performance, production deployment, write-pause timing,
rollback rehearsal and cutover remain unverified or separate work. The monitoring
retention period after a future cutover is unchanged by this implementation.

All 11 section-1 items are complete on the feature branch. Merge/deploy approval,
browser rehearsal, RDS performance and the remaining cutover prerequisites stay
separate. A final direct-query audit also found the customer-name lookup in
`getPerformerInfo` still uses MongoDB; it is tracked as customer-write attribution
work before cutover, outside these 11 listed reads.

## Observed known-difference counts, 2026-11-12

Counts below are comparison occurrences across repeated scopes and endpoints, not
distinct source records. No numeric, membership or feed-clock differences are waived.

| Documented conversion | Observed occurrences |
|---|---:|
| legacy history clock converted by the copy, on its source branch (or its own Date.toString clock) | 174 |
| a field no screen reads, not copied (firstName / lastName on 2 old records, lastLoginIp) | 100 |
| resource customer name is the current parent name, rather than an old stored copy | 84 |
| legacy single photo URL, copied as a one-element attachment array with the same URL | 4 |
| a legacy visit author is not an account id, blanked by the copy (the author name stays) | 7 |
| old follow-up day saved as midnight UTC, copied as the same calendar day | 406 |
| a legacy contact explicitly stored isPrimary=false; the profile omits this unused default | 4 |
| a contact without an id gets the copy's deterministic id | 4 |
| MongoDB's stored copy of the rep's name is out of date; Postgres reads the user's name now | 81 |
| old customer with no geocode block; Postgres stores the default "pending" | 57 |
| a link to a deleted customer, which the copy leaves out | 14 |
| saved without createdAt / updatedAt in MongoDB; Postgres has the time from its id | 628 |
| legacy calendar clock copied to its source user branch, checked against the exact source value (normal reads only) | 70 |
| calendar lean feed exposes the exact model default for a field missing on that source entry | 239 |
