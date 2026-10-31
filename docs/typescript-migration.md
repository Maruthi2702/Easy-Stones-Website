# TypeScript migration inventory

Audit date: 2026-10-31. Counts exclude dependencies, build output, hidden
directories/worktrees, and declaration files. Tests count as files, not app modules.

| File type | Before this batch | Remaining |
| --- | ---: | ---: |
| `.js` | 322 | 294 |
| `.jsx` | 42 | 35 |
| `.mjs` | 3 | 3 |
| **Total** | **367** | **332** |

Remaining: **202 application modules**, **107 tests**, **23 tooling/harness files**.
This is an incremental migration; the remaining files still need conversion.

Regenerate counts and the complete file list:

```sh
npm run audit:typescript
npm run audit:typescript -- --list
npm run audit:typescript -- --json
```

| Area | Remaining JS/JSX files, including tests |
| --- | ---: |
| Shared utilities (`src/utils`) | 111 |
| Permits | 57 |
| Components | 33 |
| Routes | 33 |
| Models | 24 |
| Services | 20 |
| Holds | 10 |
| Accounting | 8 |
| Pages | 8 |
| Jobs | 2 |
| Purchasing | 1 |
| Server helpers | 1 |
| App entry (`src/App.tsx`) | 1 |
| Root/server/tooling | 5 |
| Scripts | 17 |
| Harness | 1 |

## Converted in this batch

35 files: 26 application modules and nine existing test files.

- Shared utilities: phone, text, image paths, location codes, contact values,
  date formatting, slab statuses, Check In permissions, Lost Sales permissions.
- Branch configuration and timezone/date helpers.
- Accounting: money parsing/formatting, transaction IDs, permissions.
- Holds permissions and shared permission principal type.
- Inventory display formats and navigation icon maps.
- Product/color seed data.
- React: root entry, CategoryNav, ErrorBoundary, Footer, PresenceReporter,
  ScrollToTop, WarrantyPage; sign-in theme hook.
- Existing tests for phone, location codes, contact values, slab statuses,
  branches, accounting money/IDs, Check In access and Lost Sales access.

Explicit imports, HTML/build entry points, the server import checker, and
documentation references follow the new filenames. The conversion keeps
strict checking enabled, with no `@ts-nocheck` or new explicit `any` types.

## Continue bottom-up

1. Remaining shared utilities and their tests; keep browser and server rules
   in the same module.
2. Component helpers/hooks and React components, then public/auth pages and App.
3. Models and services, then route modules and integration tests. Keep existing
   work in progress intact when converting files already modified locally.
4. Server entry points and maintenance/build scripts. Update package scripts
   and hosting references when renaming server entry points.

Use `.tsx` for JSX and `.ts` for other modules. Node 24 loads server/shared
TypeScript directly: keep exact `.ts` import paths and erasable syntax.
Run strict type checking, server import validation, affected tests, and the
production build for each batch. Recheck relevant screens before deploying.

## Validation for this batch

- `npm run typecheck` and `npm run build` passed.
- Full test run: 2,477 passed, four skipped, eight timed out across five files.
  Rerunning those five files with `--maxWorkers=1` passed all 93 tests;
  collectively all 2,485 runnable tests passed.
- ESLint on the converted files found the existing synchronous state update
  in WarrantyPage's URL-selection effect (`react-hooks/set-state-in-effect`).
  That navigation behavior is unchanged by this migration.
- The server import checker still warns about three legacy admin scripts
  importing the absent `src/models/Admin.js`; those warnings predate this batch.
- Screens have not been manually checked in a browser; nothing was deployed.
