# Customer read migration report

Status: all 11 remaining read items are implemented on `feat/pg-customer-reads`.
Integrated validation is in progress. This report does not authorize deployment or
cutover. Production remains on MongoDB with `DB_CUSTOMERS` unset.

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
| 5 | `POST /api/customers/possible-duplicates`: existing scorer with customer signals and separation links | `bb22ed8` | Map/calendar group: 50 shared tests | Preserved |
| 6 | `GET /api/dashboard/stats`: scoped rollups and unchanged shared follow-up counts | `7d6639e` | 20 new dashboard parity + 14 existing integration tests, 34 shared total | Preserved |
| 7 | `GET /api/dashboard/visits`: scoped, ordered visit rows | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 8 | `GET /api/dashboard/followups` and `/followups/panel`: shared loader, unchanged due/status/panel rules | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 9 | `GET /api/dashboard/resources`: quantities, notes, status, customer fields and uploader names | `7d6639e` | Dashboard group: 34 shared tests | Preserved |
| 10 | `GET /api/schedule`, team scope and `GET /calendar/feed/:userId.ics` | `bb22ed8` | Map/calendar group: 50 shared tests | Preserved |
| 11 | Customer snapshots for Holds, contact matching for Permits, and price/active lookups for the public catalog | `d9a9b54` | Small-read suite: 15 shared tests | Preserved |

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
  strings. **Live count: PENDING.** It is documented in `src/db/README.md`; no broader
  customer-name discrepancy is accepted.
- Existing documented profile time, default and join differences remain subject to
  the narrow `KNOWN_DIFFERENCES` predicates. **TODO: fill current live counts.**
- `src/db/customers/readPreflight.ts` fails comparison readiness for a missing
  customer `status` or a copied visit/resource day that differs from the source
  dashboard's range day. These conditions require source cleanup or an explicit
  schema decision before cutover. Numeric counts and range membership have no
  allowances.

## Integrated validation

| Check | Result |
|---|---|
| Focused small-read suite | 15 passed |
| Focused map/calendar parity and existing route suites | 50 passed: 9 new + 41 existing |
| Focused dashboard parity and existing integration suites | 34 passed: 20 new + 14 existing |
| Independent MongoDB-path read-only review | No MongoDB behavior changes found |
| Initial full-suite run | 3,681 passed, 4 skipped; one suite encountered files being edited and passed its subsequent targeted rerun. This is not the final integrated full-suite result. |
| Final integrated full test suite | **TODO: final command, counts and result** |
| Final integrated typecheck | **TODO: result** |
| `npm run pg:compare`, with lookup/map-calendar/dashboard registrations | **TODO: final read count, source preflight result and differences** |
| Server boot against in-memory MongoDB, `DB_CUSTOMERS` unset, `/api/health` | **TODO: final result** |
| Integration against current `origin/main` | **TODO: record final base and feature commit** |

The live comparison reads MongoDB only and copies into disposable PGlite. The group
registrations are `scripts/pg-compare-lookups.ts`, `scripts/pg-compare-map-calendar.ts`
and `scripts/pg-compare-dashboard.ts`, called by `scripts/pg-compare.ts`.

## Limits and remaining owner decisions

No SQL schema migration, AWS infrastructure change, RDS write, live MongoDB write,
production environment change or cutover is part of this read batch. Browser screen
rehearsal, actual RDS query performance, production deployment, write-pause timing,
rollback rehearsal and cutover remain unverified or separate work. The monitoring
retention period after a future cutover is unchanged by this implementation.

The final report must state any outstanding source preflight failures, unexpected
read differences or incomplete checks before requesting merge/cutover authorization.
