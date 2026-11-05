# Automated tests

Use Node 24 or newer and install dependencies with `npm ci`.

| Command | Purpose |
| --- | --- |
| `npm test` | All Vitest logic, React, API and database tests |
| `npm run test:watch` | Watch Vitest tests while editing |
| `npm run test:coverage` | Full Vitest suite plus coverage, including untested source files |
| `npm run test:e2e` | Chromium desktop and phone browser journeys |
| `npm run test:e2e:ui` | Interactive Playwright test runner |
| `npm run typecheck` | TypeScript, server import rules and TypeScript migration audit |
| `npm run lint` | ESLint checks |

Run a particular suite with `npm test -- src/pages/ContactPage.test.tsx`,
or a browser case with `npm run test:e2e -- --grep "Team Files"`.

## Test layers

Vitest discovers `src/**/*.test.{js,ts,tsx}`. Pure logic and backend tests
use Node; React tests opt into jsdom per file. Backend suites use temporary
MongoDB databases and local HTTP servers. They need permission to bind local
ports; the MongoDB test binary may need downloading on the first run. A
restrictive sandbox can produce `listen EPERM` failures before assertions run.

Playwright starts a separate Vite server at `http://127.0.0.1:4175`. Its
fixtures intercept only requests to that server's `/api/` paths, and each
browser test gets fresh session state. The browser suite renders real app
components with deterministic API responses; it does not contact a production
database or sign into a real account. Backend integration suites exercise the
actual API and database layer separately.

Install a browser once if it is missing:

```sh
npx playwright install chromium
```

## Page and module tests

| Area | Main suites |
| --- | --- |
| Public home and category state | `src/pages/HomePage.test.tsx`, browser collection journey |
| Product detail and price visibility | `src/pages/ProductDetail.test.tsx`, `src/context/ProductProvider.test.tsx`, `src/routes/publicProducts.test.ts` |
| Contact submissions | `src/pages/ContactPage.test.tsx`, browser validation and submission journey |
| Warranty and resource links | `src/pages/WarrantyPage.test.tsx`, browser section navigation |
| Portal and staff login | `src/pages/CustomerLoginPage.test.tsx`, `src/pages/LoginPage.test.tsx` |
| First password and emailed invites | `src/pages/passwordSetup.test.tsx`, `src/routes/userOnboarding.test.ts` |
| Admin product editor and settings | `src/pages/AdminPage.test.tsx`, browser Admin journey |
| App routing and protected pages | `src/App.test.tsx`, browser login redirect and Sales journeys |
| Auth/session state | `src/context/AuthContext.test.tsx`, `src/services/staffSession.test.ts` |
| Sales navigation and shell | `src/features/salesShell/*.test.*`, `e2e/staff.spec.ts` |
| Dashboard | `src/features/dashboard/**/*.test.*` |
| Customers and imports | `src/features/customers/**/*.test.*`, `src/routes/customer*.test.ts` |
| Visits | `src/features/visits/useVisitEditor.test.tsx`, `src/routes/visits.test.ts` |
| Resources | `src/features/resources/**/*.test.*`, `src/routes/customerResources.test.ts` |
| Route planner | `src/features/routePlanner/**/*.test.*` |
| Sales planner and schedules | `src/features/salesPlanner/*.test.*`, `src/routes/schedule.test.ts` |
| Calendar sync | `src/features/calendarSync/CalendarSyncModal.test.tsx` |
| Team Files | `src/features/teamFiles/teamFiles.test.tsx`, `src/routes/teamFiles.test.ts`, browser search journey |
| Inventory Analysis | `src/components/sales/InventoryAnalysisTab.test.tsx`, inventory import/transit backend suites |
| Lost Sales | `src/components/sales/LostSalesTab.test.tsx`, `src/utils/lostSaleAccess.test.ts` |
| Crossover Sheet | `src/components/sales/CrossoverSheetTab.test.tsx`, `src/components/sales/crossoverSheetHelpers.test.ts` |
| User profile | `src/components/sales/UserProfileTab.test.tsx` |
| Permits | `src/components/sales/permits/PermitsTab.test.tsx`, `src/permits/*.test.ts` |
| Check-in and selection sheets | `src/features/checkin/checkin.test.tsx`, `src/routes/checkIn.test.ts`, check-in utility suites |
| Delivery | `src/features/delivery/**/*.test.*`, delivery route and utility suites |
| Daily reports | `src/features/dailyReport/*.test.*`, daily report route and job suites |
| Payments | `src/features/payments/payments.test.tsx`, `src/routes/paymentsReceived.test.ts` |
| Purchasing | `src/features/purchasing/*.test.*`, `src/purchasing/*.test.ts` |
| Freight/accounting | `src/features/freight/*.test.*`, `src/accounting/*.test.ts` |
| Fuel Man | `src/features/fuelman/*.test.*`, `src/fuelman/*.test.ts` |
| Holds and cart | `src/features/holds/**/*.test.*`, `src/holds/*.test.ts` |
| Users, roles and locations | `src/features/users/**/*.test.*`, team/onboarding backend and permission suites |
| Visit/resource types | `src/features/types/typeList.test.tsx`, `src/routes/typeLists.test.ts` |

Tests check behavior rather than requiring a separate test file for every
component, type declaration, stylesheet or asset. A module appearing in this
table means it has tests; it does not mean every branch in it is covered.

## Reports and remaining gaps

`npm run test:coverage` writes an HTML report to `coverage/index.html`, a
machine-readable summary to `coverage/coverage-summary.json`, and LCOV output
to `coverage/lcov.info`. Its source include pattern covers `src` and
`server.ts`, so runtime files that no test executes remain visible at zero
coverage. Test files, declarations and testing fixtures are excluded.
Coverage does not measure CSS, images or whether assertions are sufficient.

The coverage command uses two workers and longer individual-test timeouts
because instrumentation adds overhead to database and password-hashing tests.
The measured baseline on 2026-11-05 is 61.22% statements, 55.54% branches,
57.95% functions and 62.7% lines. The command enforces respective minimums of
61%, 55%, 57% and 62%, including untested runtime source in the denominator.
These are whole-project minimums; individual files still have gaps, and the
report does not claim 100% file, line or branch coverage.

Playwright writes an HTML report to `playwright-report/index.html` and retains
screenshots and traces for failed cases in `test-results/`. These generated
directories are ignored by Git. Open a failed trace with
`npx playwright show-trace test-results/<case>/trace.zip`.

The check-in API suite conditionally runs one of two groups according to
`NEW_VISITS_START_WITH_REP`. Cases for the inactive behavior are reported as
skipped; they should not be counted as passing assertions.

Validation on 2026-11-05: 234 Vitest suites passed, with 2,952 passing tests
and four conditionally skipped tests. The additions include 149 Vitest cases
in 16 suites and 70 Playwright cases across desktop and phone configurations.
TypeScript checks and ESLint checks for changed files pass. Whole-project
ESLint still reports five existing errors in unchanged files: `CustomerFinder.tsx`,
`usePaymentsSummary.ts`, `permits/rules/yakima.ts`, `permits/sources/anacortes.ts`
and `routes/transferArrival.test.ts`.
