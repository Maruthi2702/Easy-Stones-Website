# Tech stack review — pending decision

Discussed 2026-10-11. On 2026-10-23 the owner asked to move to TypeScript,
Django and PostgreSQL/DynamoDB; those plans and answers are in
[`MIGRATION_NOTES.md`](MIGRATION_NOTES.md) (**proposed, awaiting approval**).
Nothing has been started.

## Current stack (2026-10-11)

- **Frontend:** React 19 + Vite 5, plain JavaScript (JS/JSX). ~358 files, ~81k lines in `src/`.
- **Backend:** Node.js (>=20.19) + Express 5. `server.ts` is ~6,500 lines with 129
  routes inline; the rest (~12.7k lines) is in `src/routes`, `src/models`,
  `src/services`, `src/accounting`, `src/holds`, `src/permits`.
- **Database:** MongoDB via Mongoose 9. Accounting and Holds already use
  transactions (replica set) and have in-memory MongoDB tests.
- **Hosting:** Render. `main` is live; no staging.

JS was never a deliberate choice — it's the default React + Vite setup and the
app grew from there.

## Options discussed

| Area | Recommendation | Why |
|---|---|---|
| Frontend framework | **Stay on React** | Most used by far; already on the latest (19). Vue/Svelte/Angular would mean rewriting 81k lines for no gain. Next.js adds SEO/server rendering an internal staff tool doesn't need. |
| JS → TypeScript | **Yes, gradually** | Catches wrong field names / missing props / null bugs in the editor; shared components get a checked contract (what CLAUDE.md's grep audit does by hand). Won't catch CSS or logic bugs like the CustomSelect or Daily Report incidents. |
| Backend framework | **Stay on Node + Express** | Same language as the frontend, so types can be shared. Fastify/NestJS/Hono/Python/Go are all fine but mean a rewrite with no real benefit at our scale. |
| `server.ts` | **Split it up** | 129 routes in one untested 6,500-line file is the real backend risk. Move routes into `src/routes/<area>.js` like `checkIn.js` / `deliveries.js`. |
| Database | **Stay on MongoDB for now; tighten it** | Our data is mostly relational (customers ↔ deliveries, holds ↔ slabs, accounting), which is what PostgreSQL is best at — but migrating a live app with no staging is months of risk. Get most of the safety on Mongo instead: strict schemas (`required`, `enum`), unique indexes where duplicates are bugs, transactions for multi-collection writes, all writes through rule files like `customerRecord.js`. Revisit Postgres only for a rebuild or if Accounting grows into full ledgers. Never run both. |

## Suggested order (if approved)

1. TypeScript setup: `tsconfig.json` with `allowJs: true`, so `.js` and `.ts`
   live side by side. Convert the tested `src/utils/*.js` rule files first.
2. Split `server.ts` into route files, one area at a time.
3. Shared types between frontend and backend (Customer, Delivery, CheckIn…).
   Then convert `src/api/`, then `src/components/shared/**`, then pages/server
   file by file as they're touched.
4. Tighten Mongoose schemas and indexes.
5. A staging environment (deferred by the owner 2026-10-07) — the biggest
   safety win of all.

No big-bang rewrite: everything above is file by file alongside feature work.

## Open questions for the review

- Start TypeScript at all, and if so, now or after the current feature work?
- `server.ts` split before or after TypeScript?
- Is a staging environment back on the table?
