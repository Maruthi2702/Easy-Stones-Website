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

The `feat/typescript-hardening` follow-up replaces the model-wide `Loose`
generics with schema-derived or explicit document contracts, including password
methods and nested document identities. Settings and heterogeneous snapshot
fields use `unknown` where each consumer must check the stored value. Some
legacy controller and UI records still use `Loose`; conversion of an extension
alone does not guarantee that every boundary has a complete type contract.

Legacy scalar controllers now validate query and path values before running;
repeated query values and nested query objects receive HTTP 400. Endpoints
that intentionally accept arrays keep their own contracts. Mongoose schemas
continue to validate writes at runtime. Props, events, middleware, sessions,
callbacks, request fields, parser results and other stable contracts have explicit types. No
`@ts-nocheck`, `@ts-ignore`, or weaker compiler options were added.

The three obsolete Admin maintenance scripts already failed because their model
was removed. They continue to fail before connecting to a database, now with a
clear message directing users to Users & Roles.

## Validation

- Whole-project strict type checking passed on the current files.
- The production build passed on Node 24.22.1, including the server import and
  zero-JavaScript-source checks (271 server graph files, all TypeScript).
- The full Node 24 test suite passed: 201 test files, 2,643 tests passed and
  four tests skipped. No failures were reported.
- ESLint passed across 1,049 files: zero errors and zero warnings, resolving
  the earlier 74 errors and 15 warnings. No lint rules were disabled to make
  these checks pass.

The isolated native Node 24.22.1 smoke test passed: connected health/database
ping, public catalog pricing restrictions, cold and warm catalog reads (including
a direct temporary-database change proving the cached snapshot is reused),
built HTML serving, and JSON 404 responses. The hardening smoke check also
verified authenticated identity, fresh role permissions, valid dashboard
queries (200), and repeated scalar query values (400). The temporary server and MongoDB
were cleaned up. External HTTP was blocked and real credentials were cleared.

The browser smoke test covered the public catalog, warranty navigation and
login with mocked APIs, with no page errors. Model review confirmed unchanged
runtime schema paths, defaults, options and indexes; Customer/User password and
lock methods were also exercised natively. A regression test covers legacy daily
reports with missing visitor figures.

Changes are on `feat/typescript-hardening`. Nothing was deployed or merged.
