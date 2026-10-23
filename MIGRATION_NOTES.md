# Migration notes

Plans for moving the app's stack, written 2026-10-23 when the owner asked to
move the frontend to TypeScript, the backend to Django, and MongoDB to
PostgreSQL or DynamoDB. **Nothing here is approved or started.** The original
2026-10-11 review is [`TECH_STACK_REVIEW.md`](TECH_STACK_REVIEW.md).

The rule for all of it: **no feature may break.** `main` is live and there is
no staging server, so every step below is small, reversible, and checked by
hand on the screens it touches as well as by `npm test` and `vite build`.

## Where things stand (2026-10-23)

| Area | Today | Plan | Status |
|---|---|---|---|
| Frontend | React 19 + Vite 5, JavaScript | Stay on React; JS → TypeScript gradually | Proposed |
| Backend | Node + Express 5, `node server.js` on Render, Node 20.19 | Stay on Node; Node 24, split `server.js` | Proposed |
| Django | — | **Not recommended** | Answered |
| Database | MongoDB (Mongoose 9) | PostgreSQL (not DynamoDB), one area at a time | Proposed |
| Staging | None (deferred by the owner 2026-10-07) | Needed before any database move | Owner to decide |

## Overall order

1. **TypeScript setup** (no runtime change) and browser-only files — can start
   any time, runs alongside feature work.
2. **Staging server** with a copy of production data.
3. **Node 24 on Render** as its own change (Node 20 reached end of life
   2026-04-30, and it can't load `.ts`).
4. **Split `server.js`** into per-area route files.
5. **Shared files to TypeScript**, now that Node 24 can load them.
6. **A data layer per area**, still on MongoDB, then **PostgreSQL one area
   at a time**, Permits first.
7. **Server-only files to TypeScript**, alongside 4–6.

## Decisions waiting on the owner

- Approve the TypeScript plan and its pace (foundations as dedicated work,
  screens converted as they're touched — my recommendation).
- Move Render to Node 24.
- PostgreSQL as the target, hosted on Render.
- Bring staging back before any data moves.
- Short early-morning write pauses, one per area as it moves to Postgres.

---

## 1. Frontend: JavaScript → TypeScript

The frontend is already React 19, so this is JS → TS only. Numbers from
walking the import graph from `src/main.jsx` and from `server.js` + `scripts/`:

| Files | Count | Lines | Who loads them |
|---|---|---|---|
| Browser-only | 207 (145 `.jsx`) | ~55k | Vite only |
| Shared | 69 (38 `src/utils`, 24 `src/permits/rules`, + accounting/holds/config) | ~9.6k | Vite **and** `node server.js` |
| Server-only | 106 + `server.js` | ~20k + 6.5k | Node only |

**The constraint:** Render runs `node server.js` on Node **20.19** with no
compile step. Node 20 can't load a `.ts` file (`ERR_UNKNOWN_FILE_EXTENSION`,
checked); Node 24 strips the types itself (checked). So a shared file renamed
to `.ts` on Node 20 crashes the live server at start. Node 20 also reached end
of life on 2026-04-30.

**Checked in a throwaway worktree (2026-10-23):** a `tsconfig.json` with
`allowJs` type-checks the whole tree with zero errors in ~2s; converting
`paginationConfig` + `Pagination` to `.ts`/`.tsx` took two typing-only fixes,
its 32 tests passed and `vite build` succeeded. Type-checking today's JS as-is
gives ~900 loose / ~9,700 strict errors, sampled as inference noise (defaults
like `= {}`), not hidden bugs.

**Steps**

1. **Setup (no runtime change):** `typescript` + `typescript-eslint`,
   `tsconfig.json` (`allowJs`, `strict` for `.ts` only, `noEmit`,
   `erasableSyntaxOnly`), `npm run typecheck` (tsc + a check that nothing
   `server.js` loads is `.ts` until step 4), Vitest/ESLint globs for
   `.ts`/`.tsx`. Deploy keeps `vite build`; typecheck joins the pre-merge
   check, and joins the build once the tree is clean.
2. **Data types** in `src/types/` (Customer, Delivery, CheckIn, Location,
   User, Hold, Permit…) from the Mongoose models and what the API returns,
   plus a typed `authFetch` JSON helper.
3. **Browser-only, bottom-up:** `src/api` → `src/context` →
   `src/components/shared/**` (props become a checked contract — the grep
   audit CLAUDE.md asks for) → browser-only utils → screens one module at a
   time, `SalesPage.jsx` (5.4k lines) last.
4. **Node 24 on Render** as its own change (`NODE_VERSION`, `engines`;
   smoke-test sharp, tesseract, PDFs, Playwright permit readers). Then the
   shared files, erasable syntax only (no `enum`/`namespace`), imported with
   `.ts` extensions.
5. **Server-only** files, with or after the `server.js` split.

**Rules for every conversion commit:** `git mv` + types only, no behaviour
change; fix importers in the same commit; typecheck + `npm test` +
`vite build` + open the screen by hand; update CLAUDE.md / KNOWN_ISSUES.md
where they name the renamed file; no CSS/z-index edits ride along.

---

## 2. Backend: Django? Not recommended

Asked 2026-10-23. A move to Python/Django is a rewrite of the whole backend
on a live app with no staging, and it costs more than it fixes.

| Backend today | Size |
|---|---|
| API routes | ~275 (128 in `server.js`, 147 in route files) |
| `server.js` | 6,742 lines |
| Database models | 25 in `src/models` (40 registered in all) |
| Server test files | 39 |
| Live socket updates (`emit`) | 50 |
| Files the server shares with the screens | 69 |

- **Every route is rewritten**, and most have no tests, so each one is
  re-checked by hand. Months before Django could replace what runs today.
- **The shared rules split in two.** 69 files (permissions, customer write
  rules, permit rules, branch clocks) run in both the browser and the server
  today. In Python each rule would exist twice and drift — the class of bug
  CLAUDE.md's "one rule, one file" sections exist to stop.
- **Django assumes a SQL database.** Its admin, ORM and migrations are built
  for Postgres-style databases; MongoDB support is newer and limited. So
  "move to Django" really means two migrations at once.
- **Live features rebuilt:** the delivery board, instant cart ticks and the
  Online list run on Socket.IO; in Django that's Channels + Redis, and the
  in-memory presence list needs a new design.
- **Tests rewritten:** Accounting, Holds, Permits and Check In server tests
  run on Vitest with an in-memory MongoDB.
- **No shared types:** the TypeScript plan's main gain — one definition of a
  Customer or Delivery for both screens and server — is lost.

What fixes the real backend risks instead: split `server.js`, Node 24 then
TypeScript, tighten the database, staging. Python would make sense only as a
small separate service for one job it's clearly better at (heavy data
analysis, machine learning), next to Node, not replacing it. If something
specific draws the owner to Django (its admin screens, a library, hiring),
that could change the answer.

---

## 3. Database: MongoDB → PostgreSQL

The owner asked to move off MongoDB to PostgreSQL or DynamoDB. **PostgreSQL.**
DynamoDB only answers questions designed into its keys in advance: the
Customer List's filters, A–Z sort, "Showing 1–50 of 312" counts and
name/city/contact search, the Daily Report and dashboard aggregations and
Accounting's reports would each need extra indexes, scans or another service.
It's also AWS-only while we host on Render, and it's a bigger rewrite than
Postgres.

**How the backend uses MongoDB today** (non-test code, 2026-10-23):

| What | Count |
|---|---|
| Models | 40 |
| Files that touch the database | 114 |
| Database calls | ~665 (165 in `server.js`) |
| Aggregation pipelines | 24 in 7 files |
| Regex searches | 57 in 19 files |
| Free-form (`Mixed`) fields | 31 in 12 files |
| `$push`/`$pull`/`$addToSet` | 32 in 4 files |
| `bulkWrite` | 11 in 6 files |
| Transactions | 4 files (Accounting, Holds) |

Most references are plain strings (Delivery's `customerId`, rep and location
*names*), not `ref:` ids, so data can be orphaned today; Postgres foreign
keys would refuse those rows.

**Design**

- **The API doesn't change.** Records keep their 24-character ids as
  primary keys (text) and new ones get the same format, and responses keep
  `_id`. Links, saved filters, socket messages and every screen keep working;
  the frontend never knows.
- **Drizzle ORM** (schema in code, SQL-shaped queries, migrations, typed rows
  that become the TypeScript plan's shared types). Free-form fields → `jsonb`;
  regex search → `ILIKE` + `pg_trgm` indexes; arrays → child tables or `jsonb`;
  `bulkWrite` → `INSERT … ON CONFLICT`; the `sps.key` partial unique index
  exists in Postgres too. Tests move from in-memory MongoDB to PGlite
  (Postgres in-process, no Docker).
- **Render Postgres**, same region as the web service.
- **One area at a time.** During the move each collection lives in exactly
  one database — never the same data in both (what "never run both" meant).

**Order**

1. **Staging with a copy of production data.** A database move without it is
   the riskiest change this app could make. (Deferred by the owner
   2026-10-07; this is the time to bring it back.)
2. **Node 24, then split `server.js`.** Its 165 database calls must move into
   area files anyway.
3. **A data layer per area** (`customers`, `deliveries`…): every Mongoose call
   behind functions with tests, still on MongoDB. The switch then rewrites
   only those files.
4. **Pilot: Permits.** Self-contained, mostly server-only, well tested, and
   its data can be re-pulled from the sources if anything goes wrong.
5. Logs, backups, settings, imports → Accounting (already transactional,
   gains most) → Cart & Holds and Inventory → the core last, which
   everything points at: Users/Roles/Locations, Customers, Deliveries and
   Schedule, Check-ins, Daily Reports.

**Each area's cutover:** rehearse on staging; then a short write freeze early
morning, copy, verification script (row counts, every row compared, each
screen opened), flip the area's setting to Postgres. Mongo keeps a read-only
copy for two weeks with a reverse-copy script, so going back is one setting
plus one script. Foreign keys are added after a clean-up pass, not at the
copy, so the move itself changes no behaviour.
