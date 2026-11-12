# The way back: Postgres → MongoDB (customer area)

For the 2 weeks after cutover (DB_MOVE_CHECKLIST.md §4): if the customer area has to go
back to MongoDB, `scripts/pg-reverse.ts` rebuilds its collections from Postgres.

    DATABASE_URL=… MONGO_URI=… node scripts/pg-reverse.ts                    dry run
    … node scripts/pg-reverse.ts --apply --confirm <mongo database name>    swap in
    --out <folder>   also keep the documents as JSON

- **Replaces exactly:** `customers` (with contacts, visits, reactions, follow-up history,
  resources, login and links inside, as before), `schedules`, `activitylogs`,
  `customerdeletebackups`, `customermergebackups`, `importmemories`, `spsimportruns`,
  `spsimportitems`. Users, roles, locations and the type lists were never moved, so they are untouched.
- **Safe to run:** each collection is built beside the real one (`<name>__reverse`), given the real
  one's indexes (a duplicate email stops it here), counted, and only then renamed over it. A failure
  leaves MongoDB as it was. Run it with customer writes paused, as the forward copy is.
- **Rows → documents** is `docs.ts`, built on `src/db/customers/customerDoc.ts` (the same shapes the
  screens read). `reverse.test.ts` proves the round trip: MongoDB → Postgres → MongoDB → Postgres gives
  the same rows.
- **Not identical to what MongoDB held before,** by the copy's own rules (checked on the live data
  2026-11-12): a time MongoDB held as a real date or as text comes back as one local-clock text
  (activity log, contact `createdAt`, visit `updatedAt`); a follow-up date stored as midnight UTC comes
  back as the day; `salesRepName` is the rep's display name; a resource's `customer` is the company (or
  contact) name; a link to a deleted customer, an unknown `createdBy` and the stray `firstName` /
  `lastName` fields are gone; schedules gain `source: 'manual'`; `lastLoginIp` is the latest of `loginIps`.
