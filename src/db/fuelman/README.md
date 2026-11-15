# Fuel Man on Postgres (switch `DB_FUELMAN`)

`src/fuelman/*` (import, review, assignments, publish, reverse, close, P&L, lists) reads and writes only
through a **store** (`index.ts`), one per unit of work: `fleetTransactionOf` for a write that must land whole
(also counts one revision of the fleet), `snapshotOf` for a consistent read, `fuelStore()` for a single read.
`mongo.ts` is the old Mongoose code moved behind the store; `postgres.ts` is SQL. Unset = MongoDB.

- Postgres answers in MongoDB's shape: string `_id`, `__v` (the `version` column), `to: ''` while an assignment
  is open, `importedBy: { id, name }`.
- New ids are made by the caller with `newId()` (reports, their PDF row, assignments, costs, history), so both
  databases get the same one.
- `fuelman.parity.test.ts` runs every route (import, list, lines, source, assign, batch, classify, missing
  driver, publish, carry-back, correction, reverse, close) on both databases and compares the answers and
  every table (`verifyCopy`). `fuelman.concurrency.test.ts` makes the races overlap on a real Postgres
  (`PG_RACE_URL=postgres:///es_race`; skipped without it).

## How the rules are kept

- **One writer per fleet at a time:** every write first takes the fleet's `acct_fuelman_state` row (insert if
  missing, then `revision + 1`), so a second writer waits for the first to commit — what MongoDB's write
  conflict used to force. A month's revision numbers stay dense (`period_key, revision` is unique).
- **A stale screen can't overwrite:** the report's `version` is checked in the same `UPDATE … WHERE version = $n`,
  and the review **token** (a hash of the assignments, decisions and overrides) is checked before it.
- **The token ignores key order** (`digest` in `review.ts` sorts keys): Postgres' `jsonb` keeps an object's keys
  in its own order, and a token must not change with it.
- **A published report's costs are inserted with the report's change to `posted`**, in the one transaction.

## Intended differences

- `undefined` inside a value a request *updates* is saved as `null` on both (MongoDB's BSON does that; the store
  copies it); inside a new document it is dropped on both.
- Users, roles and branches (who the drivers are, who has access) still read MongoDB until Users moves (last).
  A card is matched to `user:<id>`, which is the same id in both.
- Facts are listed by statement line, then branch (MongoDB listed them in insert order, which was the same).

## Cutover

Pause (`FUELMAN_WRITES_PAUSED=true`: every Fuel Man write answers 503; reads carry on) →
`pg-copy-aws.ts --scope fuelman --write` → `--verify` → `DB_FUELMAN=postgres` on Render → pause off →
`--lock … --scope fuelman`. Read-only check on live data: `node --env-file=.env scripts/pg-compare-fuelman.ts`.
`/api/health` shows `fuelmanOn` and `fuelmanWritesPaused`.
