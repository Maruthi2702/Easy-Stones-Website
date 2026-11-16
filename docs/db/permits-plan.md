# Permits: moving to Postgres (plan, 2026-11-15)

Written for the owner. Nothing here is built yet. Same pattern as every other area
(`DB_MOVE_CHECKLIST.md`): data layer behind a switch, parity test, scoped copy, pause, live
comparison, click-through, cutover, lock.

## Where Permits stands

- Five Mongoose models in `src/permits/models.ts`: `Permit` (with embedded contacts), `PermitRun`,
  `PermitCheck`, `Contractor`, `ContractorName`. Nothing else in the app reads them.
- Four files touch them: `router.ts` (the screen's API, 390 lines, ~55 model calls incl. aggregates),
  `sync.ts` (the pull; 477 lines), `contractors.ts` (WA L&I registry cache), `syncOnLambda.ts` (is a pull running).
- **Postgres already has the tables** (`src/db/schema/permits.ts`: `permits`, `permit_contacts`,
  `permit_runs`, `permit_checks`, `permit_contractors`, `permit_contractor_names`) and the whole-database
  copy builds their rows (`src/db/copy/permitsRows.ts`). That copy is locked, so a **scoped** copy is needed.
- The API runs on Lambda, but the daily pull (5 AM Pacific) and manual Refresh run on Render. Both
  must switch together, because only one database can take the pull's writes.

## What is different from the other areas

1. **The pull writes all day, not on a user's click.** A pull in progress at cutover would write to
   MongoDB after the copy. So the pause must also stop the 5 AM job and Refresh, and cutover must not
   start while a run is open (`finishedAt` null).
2. **Aggregates.** The list, counts by category, cities, contractor counts and the PDF use Mongo
   `aggregate` (`$unwind` on contacts, `$group`). These become SQL joins on `permit_contacts`. This is the
   biggest piece of the work.
3. **Dates are text** (`issuedOn: 'YYYY-MM-DD'`). Keep them text so sort and filter match exactly.
4. **Contacts are embedded in Mongo, a table in Postgres.** The layer must give back the permit with a
   `contacts` array in the same order.
5. **No automatic `updatedAt`** (it would make every permit look changed each pull). Postgres must not add one.

## Steps

1. **Data layer** `src/db/permits/` (`mongo.ts` = today's calls moved unchanged, `postgres.ts`, `index.ts`,
   README): permits (upsert by source + number, get, list with every filter, counts by category / city /
   source), contacts with permits, runs (start, finish, latest per source), checks (upsert per source + month),
   contractors and names (upsert, lookup by license / by name). Switch `DB_PERMITS`.
2. **Point the code at it:** `router.ts`, `sync.ts`, `contractors.ts`, `syncOnLambda.ts`. No behaviour change.
   Pulls write a permit and its contacts in one transaction.
3. **Parity test** `permits.parity.test.ts`: every route through the real router on both databases (list with
   each filter and sort, counts, cities, contractor pop-up data, PDF rows), plus a pull against the fake
   servers the existing reader tests use (add, update, issue date cleared, contacts changed), comparing
   every table after each step.
4. **Scoped copy** `--scope permits` (6 tables, tested in `areaCopy.test.ts`), `--lock`, and write pause
   `PERMITS_WRITES_PAUSED=true`: refresh and the 5 AM job skip, any permit write answers 503, reads carry on;
   `/api/health` shows `permitsOn`, `permitsWritesPaused`. Run `--deploy` for the copy Lambda.
5. **Live comparison** `scripts/pg-compare-permits.ts` (read-only, same shape as the others): every list
   filter per source and county, counts, the contractor pop-up, the month checks. Target: 0 differences.
   Set aside known ones (key order, clocks), as before.
6. **Time it.** The list page and its counts on RDS at 38 ms a query: batch the counts into one query,
   since the screen asks for several at once.
7. **Merge to main** with the switch off (build, typecheck, tests, local boot).
8. **Owner click-through** with `DB_PERMITS=postgres` locally: Permits page, each county filter, search by
   license + Enter, contractor pop-up, Create customer from it, PDF export, Refresh one source.
9. **Cutover** (a quiet hour, not 5 AM): confirm no run is open → `PERMITS_WRITES_PAUSED=true` →
   `--scope permits --write` → `--verify` equal → `DB_PERMITS=postgres` and pause off in one Render save →
   check `/api/health` and one Refresh → `--lock`. Staff see "Refreshing is paused" for a few minutes;
   the page keeps working.
10. **After:** MongoDB permit collections read-only for two weeks. Next morning confirm the 5 AM pull
    added rows to Postgres.

## Risks and how they are covered

- A pull straddling cutover: the open-run check, and the pause also stops the scheduled job.
- A slow list on RDS: step 6, measured before cutover.
- Contractor phones or contacts reordered: parity test compares contact order.
- A pull that fails after the switch: runs record the error as now; the way back before the lock is
  to remove `DB_PERMITS` (Mongo untouched while paused).

## Order and size

Steps 1–4 are the build (about 2–3 days; the aggregates and the pull are most of it). Steps 5–7 about a
day. Steps 8–9 need the owner and Render. Users, Roles and sign-in stay last, after this.
