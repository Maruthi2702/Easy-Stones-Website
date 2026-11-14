# Daily Reports data layer (`DB_DAILY_REPORTS`)

The Daily Report routes (`src/routes/dailyReports.ts`), the 11:59 PM job
(`src/jobs/autoSubmitDailyReports.ts`), the submit email's log line
(`src/utils/dailyReportSubmissionEmail.ts`) and the Payments page's submitted-day lock
(`src/routes/paymentsReceived.ts`) read and write reports only through `index.ts`.
`DB_DAILY_REPORTS=postgres` moves them to Postgres; anything else is MongoDB.

- `mongo.ts` — the callers' own Mongoose calls, moved unchanged.
- `postgres.ts` — the same answers from `daily_reports` + `_transfers` / `_containers` / `_log`
  (`reportDoc.ts` puts the rows back into MongoDB's shape). A save builds the report through the
  same Mongoose model, then makes its rows with the copy's `dailyReportRowsOf`, so it writes what a
  re-copy of MongoDB would. Document-returning calls give a hydrated Mongoose document, so
  `applyDerived`, `report.toObject()` and the rest of the route work unchanged.
- Everything the sheet *derives* (check-ins, deliveries, payments) still goes through those areas'
  own switches; `applyDerived` and `deriveFromSystem` are untouched.

## The two writes that must never lose a race (August 2026)

Each is **one conditional statement**, as it was on MongoDB:

- **`claimSubmission`** (Submit and the 11:59 job): `UPDATE … WHERE id = ? AND status = 'draft'`.
  A second claim waits for the first one's row lock, then finds the day no longer a draft and
  matches nothing → null → 409 / no email. The submit's log line is appended in the same transaction.
- **`writeDraft`** (autosave): lock the day's row, refuse if it is `submitted`; a new day is
  `INSERT … ON CONFLICT DO NOTHING`, then the same lock-and-check. A day submitted in between is
  never turned back into a draft.
- The log is only ever appended to (`appendLog`), under the report's row lock so two appends never
  share a position. `addTransferIfSubmitted` checks "no line with this ticket yet" under the same lock.

`applyDerived` and `/submit` are **not changed** (they only read and fill the document before it
reaches these calls), so the incident's contract tests (`dailyReports.test.ts`,
`dailyReports.simulation.test.ts`) still pin them on MongoDB; the parity test runs the same requests
on both.

## Tests

- `dailyReports.parity.test.ts` (15 cases, real router + the job + the layer's own calls; MongoDB then
  Postgres; every row compared with the copy's `dailyReportRowsOf`).
- `dailyReports.concurrency.test.ts` — the races on a **real** Postgres (PGlite runs one connection).
  Skipped unless `PG_RACE_URL` is set: `createdb es_race && PG_RACE_URL=postgres:///es_race npx vitest run src/db/dailyReports/dailyReports.concurrency.test.ts`.
- Live comparison: `node --env-file=.env scripts/pg-compare-daily-reports.ts` (reads MongoDB only).

## Differences (the only ones)

- Reports of the **same day** list by branch name on Postgres (the month view, `submitted-days`);
  MongoDB leaves ties in no set order. One branch's month is unaffected.
- A status read of a day saved before `autoSubmitted` existed says `false` (MongoDB: absent).
- `__v` (Mongoose's counter) is not in Postgres answers; Postgres always answers every field
  whatever projection was asked for.
- A branch that isn't a row in `locations` can't hold a report on Postgres: a save for it throws
  (a 500) instead of being stored with no branch. Every branch the app offers is a location (checked
  on live data, 2026-11-13).
