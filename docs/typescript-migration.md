# TypeScript migration

Updated 2026-11-01. All repository application, test, and tooling source files
have moved to TypeScript. Counts exclude dependencies, generated build output,
hidden worktrees, and declaration files.

| Extension | Remaining before final migration | Remaining now |
| --- | ---: | ---: |
| `.js` | 294 | 0 |
| `.jsx` | 35 | 0 |
| `.mjs` | 3 | 0 |
| **Total** | **332** | **0** |

The first batch converted 35 files; this completes the remaining 332. React
files use `.tsx`, and other modules use `.ts`. Generated browser bundles and
third-party package entry points still use JavaScript as expected.

## Runtime and checks

- Render and `npm start` run `node server.ts` on the pinned Node 24.22.1.
- Local imports name their renamed files; server imports use exact `.ts` paths.
- The Vite, ESLint, build, maintenance-script, and harness entry points are typed.
- `tsconfig.json` checks the app, tests, server, scripts and harness with strict
  checking, erasable syntax and `allowJs: false`.
- `npm run typecheck` also checks the server import graph and rejects new
  JavaScript source files. `npm run build` runs those checks before Vite.
- `npm run audit:typescript` recounts files; `-- --list` lists remaining
  JavaScript sources, `-- --json` prints JSON, and `-- --check` fails if any remain.

Legacy BSON and external JSON records retain the existing `Loose` boundary type
where their complete persisted shape is not yet modeled. Mongoose schemas still
validate at runtime. Props, events, middleware, sessions, callbacks, request
fields, parser results and other stable contracts have explicit types. No
`@ts-nocheck`, `@ts-ignore`, or weaker compiler options were added.

The three obsolete Admin maintenance scripts already failed because their model
was removed. They continue to fail before connecting to a database, now with a
clear message directing users to Users & Roles.

## Validation

Final whole-project verification is recorded when the migration checks finish.

The isolated native Node 24.22.1 smoke test passed: connected health/database
ping, public catalog pricing restrictions, cold and warm catalog reads (including
a direct temporary-database change proving the cached snapshot is reused),
built HTML serving, and JSON 404 responses. The temporary server and MongoDB
were cleaned up. External HTTP was blocked and real credentials were cleared.

Nothing was deployed by this migration.
