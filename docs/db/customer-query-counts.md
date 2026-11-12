# Queries per screen and per save (2026-11-12, local Postgres)

Counted from the Postgres statement log while the app ran with `DB_CUSTOMERS=postgres` on a copy of the live
data (4,500 customers); begin/commit and locks not counted. "On RDS" = queries × 38 ms (Render Virginia →
RDS Ohio, one after another) + the time measured here — an upper bound, since a few run side by side.

| Request | Queries | On RDS |
| --- | --: | --: |
| Customers list (50 rows), with search | 3 | ~170–190 ms |
| Cities, view counts, map pins, one map card | 1 | 55–250 ms |
| Customer dropdown, rep counts | 0 (cached) | ~20–60 ms |
| Customer profile (with visits, resources, contacts) | 6 | ~250–280 ms |
| Moda counts | 3 | ~140 ms |
| Dashboard stats / visits / follow-ups / resources | 6 / 2 / 2 / 1 | ~65–290 ms |
| Calendar (mine / team) | 1 | ~80–100 ms |

| Save | Queries | On RDS |
| --- | --: | --: |
| Add customer | 10 | ~450 ms |
| Add / edit visit | 14 / 16 | ~580 / 650 ms |
| Add resource (also writes its placement visit and calendar note) | 22 | ~880 ms |
| Edit customer | 19 | ~770 ms |
| Add calendar entry | 6 | ~250 ms |
| Delete customer | 40 | ~1.6 s |

**Reading:** every screen load is six queries or fewer, so no read needs batching. The saves are the long ones;
the visit form already closes at once and saves behind it. If a save feels slow on RDS, the first places to look
are Add resource (the six reads after its commit rebuild the list) and Delete customer (it backs up and removes
visits, resources and calendar entries one table at a time). Not changed: those twins are proved equal to the
MongoDB saves by parity tests, and a guess at merging their statements isn't worth that. Measure on the real RDS
before deciding (`npm run pg:ping`, then this count with the 38 ms replaced by what it shows).
