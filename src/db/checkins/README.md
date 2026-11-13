# Check In + Selection Sheet data layer (`DB_CHECKIN`)

The Check In routes (`src/routes/checkIn.ts`) and the Daily Report's visitor count read and
write check-ins only through `index.ts`. `DB_CHECKIN=postgres` moves them to Postgres; anything
else is MongoDB. The Selection Sheet is not a separate collection: it is the check-in's
`selections`, notes and rep, so it moves with it.

- `mongo.ts` — the routes' own Mongoose calls, moved unchanged.
- `postgres.ts` — the same answers from `office_check_ins` + `check_in_selections`.
  A save builds the check-in with the **same Mongoose model** (trim, lower-case, length limits,
  defaults, `validate()`), then makes its rows with the copy's `checkInRowsOf`, so it writes what a
  re-copy of MongoDB would. Reads come back through `OfficeCheckIn.hydrate`, so the route changes a
  document and calls `saveCheckIn` exactly as before.
- `filter.ts` — turns the few MongoDB filter shapes the routes build (`location`, `$in`, `$nin`,
  `createdAt` `$gte`/`$lt`, regexes, `$or`, `$and`) into SQL. Anything else throws.
- Parity test `checkins.parity.test.ts` (21 cases, through the real router, MongoDB then Postgres,
  then every row compared with the copy's); live comparison `scripts/pg-compare-checkins.ts`.

## Differences (the only ones)

- A check-in with no `status` (saved before it existed) reads `New` on Postgres.
- A check-in whose branch isn't a location keeps no branch on Postgres (the copy blanks it,
  as for every area); a new one with such a branch is filed with none.
- `__v` (Mongoose's counter) is not in Postgres answers.
- An id that isn't an id throws on both (a 500), as before.
- Rows with the same `createdAt` list in id order on Postgres; MongoDB leaves ties unordered.
- Not moved here: Users (the rep-email check, the starting rep) and Locations (the letterhead,
  the QR page's branch check) still read MongoDB until that area moves.
