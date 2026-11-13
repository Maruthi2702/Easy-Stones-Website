# Delivery Schedule data layer

`index.ts` is the only thing routes call; it picks MongoDB (`mongo.ts`) or Postgres
(`postgres.ts`) by `DB_DELIVERIES` (unset = MongoDB). Routes keep their MongoDB filters;
`filter.ts` turns the subset they use into SQL and throws on anything else. A Postgres save
builds the ticket as MongoDB would hold it, then makes the row with the copy's own builder
(`deliveryRowOf`, src/db/copy/operationsRows.ts), so it writes what a re-copy would.

Tests: `deliveries.parity.test.ts` (reads), `deliveries.writes.parity.test.ts` (writes).
Live data: `node --env-file=.env scripts/pg-compare-deliveries.ts` (reads MongoDB only,
Postgres in memory; `ONLY_SEARCH=<text>` debugs one search).

## Known differences (checked on live data 2026-11-13: 1,779 requests, 1,148 tickets)

- **Fields old tickets lack.** MongoDB leaves out `customerDropOff`, `numberOfSlabs`,
  `deliveryType` and `pod` on tickets saved before they existed; Postgres holds the defaults
  (`false`, `0`, `jobsite`, an empty proof). Every screen reads them the same.
- **A `customerId` that names no customer is blanked** by the copy (9 values on live: some are
  company names typed into the field, some are customers since deleted).
- **Order search, cutoff day.** A search shows the newest 25 by date; which same-day tickets fill
  the last slots is arbitrary in both databases.
- **A field the Delivery model doesn't declare** is kept by MongoDB and dropped by Postgres.
- **A status or type outside the allowed lists** is refused by Postgres; MongoDB stored it.
- No ticket on live has a branch or transfer destination that isn't a location, so none would
  read as "no branch".
