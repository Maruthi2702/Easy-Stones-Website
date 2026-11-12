# Customer area cutover: MongoDB → Postgres (RDS)

Tonight, 2026-11-12, about 8–9 PM Pacific. About 30 minutes. Needs: the Render dashboard (owner) and the
Mac with this repo and AWS credentials (whoever runs the commands). Staff: "Customer screens pause for ~15 minutes."

## Before
- Render has deployed commit `fc53b1c` or later: `https://<the site>/api/health` shows `"customersOn":"mongo"`, `"customerWritesPaused":false`, `commit` starting `fc53b1c`.
- Render's `DATABASE_URL` is the prod RDS one (done 2026-11-12) and `npm run pg:ping` there is fine (done: 12 ms).

## 1. Pause customer writes (Render → service → Environment)
Add `CUSTOMER_WRITES_PAUSED` = `true`, Save (it redeploys; ~3–5 min). Then `/api/health` shows `"customerWritesPaused":true`.
Check: saving a customer or visit shows "Customer records are being updated…". Everything else (check-in, deliveries, payments, daily report) keeps working.

## 2. Copy and check (Mac, in the repo)
```sh
export PG_COPY_ENV=prod
export MONGO_URI='<the live MongoDB address>'     # reads only; with srv addresses that fail to resolve, use the host-list form
node scripts/pg-copy-aws.ts --write
node scripts/pg-copy-aws.ts --verify --scope customers
```
`--verify` must print **Verified: Postgres on AWS matches MongoDB…**. Anything else: stop; leave step 3 undone (turn the pause off to go back to normal).

## 3. Switch (Render → Environment, ONE save)
Set `DB_CUSTOMERS` = `postgres` and delete `CUSTOMER_WRITES_PAUSED` (or set it `false`). Save; wait for the deploy.
`/api/health` must show `"customersOn":"postgres"` and `"customerWritesPaused":false`; the Render log has "On Postgres: customers".

## 4. Open every screen, and save something
Customers list (search, filter, page 2), a profile (visits, resources, contacts, Moda), Dashboard → Visits / Resources / Follow-ups / Calendar, Route Planner map.
Then add a customer named `ZZ Cutover Test`, add a visit and a resource, tick the follow-up, add a calendar entry, and delete the customer. The visit form should close at once.

## 5. Lock (Mac) — only when step 4 is clean
```sh
PG_COPY_ENV=prod node scripts/pg-copy-aws.ts --lock "cutover 2026-11-12"
```
After this no copy can overwrite Postgres. MongoDB's customer data stays as it was, read-only, for 2 weeks.

## Going back
- **Before the lock** (nothing real written yet): remove `DB_CUSTOMERS` in Render. Writes were paused, so MongoDB still holds everything; only the test records exist on Postgres only.
- **After real use on Postgres:** pause writes (step 1), then in the Render shell: `cd ~/project/src`, `node scripts/pg-reverse.ts --apply --confirm easy-stones` (MONGO_URI there is the live one; it swaps in the customer collections whole, with their indexes), then remove `DB_CUSTOMERS`. Tried 2026-11-12 on a scratch database (src/db/reverse/README.md).

## After
Tick the checklist (§4). The marketing-email migration in `server.ts` start-up can be retired. Two weeks later: remove the customer collections from MongoDB.
