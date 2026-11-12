# Customer area rehearsal (2026-11-12, API level)

Setup: live MongoDB copied read-only into a local mongod (replica set, port 27027); `scripts/pg-copy.ts --write`
into a local Postgres (`rehearsal`), `--verify`: every table, row and column equal. Two servers on the same data:
one with `DB_CUSTOMERS=postgres` (:3055), one on MongoDB (:3056). Same requests to both, answers compared
(empty/null/missing and `__v` treated alike). Local only; Cloudinary dummied, no email.

**Reads** (110 requests: list with page/search/city, cities, view-counts, dropdown, map, rep-counts,
dashboard stats/visits/follow-ups/resources, schedule, plus profile, Moda and map card for 40 customers):
101 identical; none over 1.5 s locally. Differences, none a bug found yet:
- Sort ties: `/api/customers` row 4 and `/api/schedule` row 427 come in a different order where the sort key is equal.
- `followUpDate` is `2026-04-06` on Postgres, `2026-04-06T00:00:00.000Z` on MongoDB (copy report: "date stored as midnight UTC").
- `createdAt` `24:50` on MongoDB vs `00:50` on Postgres (copy report: "hour 24 read as 00").
- One resource (dashboard list #66): `createdAt` has no zone on Postgres (`13:41:20.140`) and `Z` on MongoDB (`21:41:20.140Z`) — 8 h apart if a screen reads it as UTC. **Check on screen.**
- `salesRepName` is the rep's display name on Postgres ("Krish") and the stored text on MongoDB ("krish") — it is a join now.
- One customer has stray `firstName` / `lastName` fields MongoDB keeps and Postgres has no column for (contactName is set, so nothing shows differently).

**Writes** on Postgres (create, edit, visit add/edit/delete, follow-up done, resource add/edit/delete + Moda,
contact add, calendar add/delete, active toggle, bulk delete + undo, delete, website register + customer sign-in):
all succeed. Register now stores `marketingEmail` / `receiveMarketing`.

**Not done:** the browser click-through of each screen; timing against RDS (38 ms per query: count the queries per
screen); rehearsal of the reverse copy (script doesn't exist yet).
