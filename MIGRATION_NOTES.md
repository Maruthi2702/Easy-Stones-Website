# Migration notes

Plans for moving the app's stack, written 2026-10-23 when the owner asked to
move the frontend to TypeScript, the backend to Django, and MongoDB to
PostgreSQL or DynamoDB. **TypeScript step 1–3 started 2026-10-23** (owner's go-ahead,
on `feat/typescript`); the rest is not approved or started. The original
2026-10-11 review is [`TECH_STACK_REVIEW.md`](TECH_STACK_REVIEW.md).

The rule for all of it: **no feature may break.** `main` is live and there is
no staging server, so every step below is small, reversible, and checked by
hand on the screens it touches as well as by `npm test` and `vite build`.

## Where things stand (2026-10-23)

| Area | Today | Plan | Status |
|---|---|---|---|
| Frontend | React 19 + Vite 5, JavaScript | Stay on React; JS → TypeScript gradually | Started; SalesPage split done (A1–A7, 2026-10-24) |
| Backend | Node + Express 5, `node server.js` on Render | Stay on Node; Node 24, split `server.js` | Node 24 approved 2026-10-23; split started |
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
- ~~Move Render to Node 24.~~ Approved 2026-10-23.
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

**Update 2026-10-23:** the owner approved Node 24, so the constraint below is
lifted on `feat/typescript` (pinned to 24.22.1; checked by booting `server.js`
on Node 24 against an in-memory MongoDB, the full test suite, and sharp,
pdf-lib, Tesseract, Playwright, xlsx and bcrypt loading). Server-loaded files
may now be `.ts` with explicit `.ts` imports; `.tsx` stays browser-only.

**The constraint (until then):** Render ran `node server.js` on Node **20.19** with no
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

---

## 4. Splitting the big files into modules (owner, 2026-10-23)

Asked alongside the TypeScript work: no more 5,000–6,000-line files — each
module's code in its own files, information passed with props, the system
designed for the long run. Same rule as everything here: **no breakage**, one
small reversible step at a time.

### Where the size is today

| File | Lines | What's inside |
|---|---|---|
| `server.js` | 6,537 | bootstrap, sockets, presence, auth middleware, ~90 routes (products, auth, admin users/roles/locations, customers, dashboard, sales-dashboard, lost sales, crossover, colors, uploads, resources…), jobs |
| `src/pages/SalesPage.jsx` | 5,583 | the shell (side nav, phone bar, tab switch), **plus** the Dashboard, the customer profile page, the visit/resource/contact forms' state, the Check-In Log's state, calendar sync, image gallery, delete confirm — 117 `useState`, 68 handlers |
| `RoutePlannerV2.jsx` | 1,722 | map, panels, filters, scheduling |
| `SalesPlannerTab.jsx` | 1,536 | the planner calendar |
| `AdminPage.jsx` | 1,435 | product admin |
| `DailyReportTab.jsx`, `PartnersSheet.jsx`, `UsersRolesTab.jsx`, `CheckInLogPanel.jsx` | ~1,000–1,170 each | |

### Frontend layout (target)

```
src/
  pages/SalesPage.tsx        the shell only: auth gate, side nav / phone bar,
                             which module is on screen (a registry), live
                             updates wiring
  features/<module>/         one folder per module, everything it owns:
    index.ts                 its public surface — other code imports only this
    <Module>Page.tsx         the screen
    components/              its parts (one job each)
    use<Module>Data.ts       loading, caching, refresh, optimistic patches
    <module>Api.ts           its calls (typed, via authFetch)
    <module>.ts (+ .test.ts) its pure rules
  components/shared/         reused across modules (unchanged role)
  api/  types/  utils/       cross-module calls, shared types, shared rules
```

Modules: dashboard, customers (list + profile), visits, resources, checkin,
calendarSync, delivery, holds, freight, permits, routePlanner, salesPlanner,
dailyReport, users, inventory, lostSales, crossover, priceList, profile,
navOrder, admin (products). Existing `src/components/sales/<module>/` folders
move into `features/` in the same commit as their TypeScript conversion — one
move per module, never a second.

### Rules

1. **Props down, callbacks up.** A module gets what it needs as props
   (`currentUser`, permission flags, ids, data it doesn't own) and reports
   changes through `on…` callbacks (`onSaved`, `onOpenCustomer`). It never
   reaches into the shell's state. Context only for what is truly app-wide
   (auth, theme, the toast).
2. **Cross-module updates go through the shell.** When a visit saved in the
   form must show on the dashboard and on the customer, the shell wires it:
   `VisitForm onSaved → dashboard.patchVisit, customer.patchVisit`. Modules
   don't know about each other.
3. **Each module owns its data** in a `use<Module>Data` hook: `{ data,
   loading, error, refresh, patch }`. Components below the page are
   presentational where they can be (props in, JSX out).
4. **One public surface** per module (`index.ts`); deep imports into another
   module's folder are refused in review (an ESLint rule later).
5. **Split by job, not by size** (owner, 2026-10-24: "500 is no limit"):
   divide a file where it does more than one thing — data loading, saving,
   a dialog, a layout — so no file is overwhelming to read. A long file
   with one clear job can stay whole; a short one mixing three gets split.
   (The ESLint `max-lines` warning at 500 was removed.)
6. **No visual change while moving:** same DOM, class names, CSS files and
   inline styles. A move is a move; redesigns are separate commits.
7. **Tests:** pure rules get `*.test.ts`; each extracted module gets a render
   smoke test (React Testing Library + jsdom, API mocked) that opens its
   screen and its main states — the first rendered-component tests the app
   has. Shared components get one when they're next touched.
8. TypeScript rules from §1 apply (browser-only files; server-loaded files wait
   for Node 24).

### Server layout (target)

```
server.js                    bootstrap only: env, database, app, middleware
                             order, mount routers, sockets, jobs, listen
src/app/createApp.js         builds the Express app (no listen) — so tests and
                             a route-table check can load it
src/middleware/auth.js       authenticate, requirePermission, requireSalesPage…
src/routes/<area>.js         one router per area, `create<Area>Router(deps)`,
                             mounted at the same path in the same order
src/services/<area>.js       logic shared by routes and jobs (images, caches,
                             presence, imports)
src/sockets/                 presence and room joins
```

Stays JavaScript with explicit `.js` imports until Node 24 (the import check
enforces it). The order routes are mounted in matters (`customerIdOnly`, the
`/api/customers` aliases), so the first step is **`createApp()` plus a
route-table snapshot test**: every method, path and middleware chain listed in
order. Each later move must leave that snapshot identical, plus the area's
own tests (in-memory MongoDB, as `src/routes/*.test.js` already do).

### Progress (2026-10-24, on `feat/typescript`, not merged)

**A1–A7 done.** `src/pages/SalesPage.tsx` is the shell, 492 lines (from
5,583): it calls the modules' hooks and wires their callbacks to each other.
What it composes:

| Folder | What's there |
|---|---|
| `features/calendarSync` | sync modal + hook (A1) |
| `features/checkin` | the Check-In Log tab, page and Selection Sheet (A2) |
| `features/visits` | `useVisitEditor`: the visit form's state, early photo uploads, save, delete check (A3) |
| `features/resources` | `useResourceEditor`, `RESOURCE_TYPES` (A4) |
| `features/customers` | `CustomerProfile` + its tabs, `useOpenCustomer` (record, cache, patches), `useCustomerActions` (contacts, partners, quick note, account, reactions), `useCustomersPage`, `useCreateCustomer`, level labels (A5) |
| `features/dashboard` | `DashboardPage`; tabs `visits/`, `followUps/`, `resources/`, `calendar/`; `teamFiles/`; `useDashboardData` (A6) |
| `features/salesShell` | navigation (page, open customer, URL, back button), side nav layout, theme, locations/reps, the socket, the delete check, `SalesTabViews` (every other page), `CustomersView`, `SalesModals` (A7) |
| `features/delivery` | the Delivery Schedule: page + `useScheduleData` / `useScheduleActions` / `usePodDialogs` / `useColumnOrders`; `board/`, `form/` (the old `DeliveryModal.jsx` deleted 2026-10-24), `pod/`, `driver/`, `search/` (B, 2026-10-24) |
| `features/dailyReport` | the Daily Report: page + `useDaySheet` (load, autosave, flush, submit), `components/` and `components/sheet/` (B, 2026-10-24) |
| `features/customers/list` | the Customers list (was `PartnersSheet` + `customerList/`): page + `useCustomerListData` / `useListFilters` / `useListActions` / `useListUi` / `useListKeyboard`, `CustomerDrawer` (shared with the Route Planner and the visit card), the profile's header/details/contacts parts (B, 2026-10-24) |
| `features/routePlanner` | the Route Planner (was `components/sales/routePlannerV2`): page + `useSavedFilters` / `useFilterView` / `useMapPins` / `useRoster` / `useMyLocation` / `usePanels` / `useDayPlan` / `useScheduleData` / `useScheduleActions` / `useLeadSearch` / `useCustomerEdit`; `map/` (MapCanvas, PinLayer, marker icons, draw gestures, directions, view), `rail/`, `panels/`, `customer/` (MapActions, ScheduleVisitSheet, the open-customer panel). The unused `AreaScheduleTrigger`, `ScheduleSummaryButton` and `statusTone` were deleted on the owner's go-ahead (B, 2026-10-24, `feat/ts-routeplanner`) |
| `features/users` | Users & Roles (Users, Roles & Permissions, Locations) and Side Nav Order: page + `useUsersData`; `userList/` (presence, filter, actions, the list), `roles/` (`useRoleEditor`, cards, page dialog, Create role, `pagePermissions`), `locations/` (actions, list, `LocationForm`), `userForm/` (Add / Edit user and parts, `userAccess`), `navOrder/` (B, 2026-10-24) |
| `features/holds` | Cart & Holds (was `components/sales/holds/`): the cart store, `useSlabLocks`, `holdLink`; `HoldsTab` + `useHoldsList` + `list/`; `hold/` (`HoldPage`, `useHoldRecord`, `holdPageActions`, header/summary/slabs/notes/history/selection bar/dialogs); `cart/` (rail button, `CartDrawer`, `CartView`, `CheckoutView` + `useCheckout`, `CartToast`, `cartLines`); `forms/` (one file per hold form); `print/` (preview, `letterPdf`, `letterOutput`). The shell imports `cart/CartDrawer.tsx` and lazy `HoldsTab.tsx` by path to keep the CSS order (B, 2026-10-24) |

How each step was checked: typecheck, `npm test` (each module has hook or
render tests), the import check, and two checks kept outside git in
`.migration-tools/`:
- **Parity**: the old page and the new page rendered side by side in 35 states
  (97 since the three operations modules: + 23 Delivery, 11 Daily Report, 28
  Customers list; 222 with the Route Planner's 45 (Google Maps faked), 40
  for Users & Roles and Side Nav Order, and 40 for Cart & Holds), with the
  same HTML required.
- **CSS check**: an order-aware comparison of the built CSS. It confirms which
  value wins for every selector, and that no rules of equal weight changed
  order. An earlier sorted comparison couldn't see order changes.

**The three operations modules (B, 2026-10-24)** were done in parallel, each
on its own branch (`feat/ts-delivery`, `feat/ts-dailyreport`,
`feat/ts-customerlist`) merged here. Every .ts/.tsx file is under 500 lines;
the CSS files moved whole. Each has a render smoke test, and the Daily Report
has hook tests pinning the draft/submit save rules (O12–O14, the 2026-08-28
incident). Bugs found on the way are in KNOWN_ISSUES.md, not fixed.

**Not done:** `useDashboardData` is 562 lines (over the 500 stop) and
`useVisitEditor` 480. Selecting a Sales page with a permission it lacks via the
back button lands on an empty page (unchanged behaviour,
`useSalesNavigation.test.tsx`). Nothing here has been clicked through in a
browser yet.

### Order

| Step | What | Risk |
|---|---|---|
| A1 | Calendar sync out of SalesPage → `features/calendarSync`; component-test setup | low (self-contained) |
| A2 | Check-In Log state → `features/checkin` | low |
| A3 | Visits: form state, save, photos, toast → `features/visits` | medium (dashboard + customer wiring) |
| A4 | Resources and dashboard folders → `features/resources` | medium |
| A5 | Customer profile page → `features/customers` | medium |
| A6 | Dashboard → `features/dashboard` | medium |
| A7 | Shell: module registry, live-updates wiring; SalesPage < 500 lines | medium |
| B | Each module: move to `features/`, TypeScript, split files that do several jobs (RoutePlannerV2, SalesPlannerTab, AdminPage, DailyReportTab, PartnersSheet, UsersRolesTab, CheckInLogPanel…) | per module |
| C1 | `createApp()` + route-table snapshot | low |
| C2+ | `server.js` areas into routers, least used first: colors, crossover, lost sales, uploads/resources, products, sales-dashboard, dashboard, admin, auth, customers | per area |

Each step is its own commit with typecheck, `npm test`, `vite build`, the
import check, and a short hand-check list for the screens it touched. Steps
reach `main` in small batches after the owner clicks through them.
