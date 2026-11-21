CC receipts accounting QA

Open REPORT.txt for the findings and limitations, or CC-Receipts-QA.xlsx for
the accounting review workbook. test-cases.csv is the portable test-case list.

The workbook contains 81 prioritized test cases, including 18 staging/policy
follow-ups that are explicitly NOT RUN. All executions lists the 297 counted
automated checks. An empty error log or a green old suite does not imply that
the added accounting acceptance controls pass.

No application behavior was changed by this audit. The new acceptance suites
are opt-in and intentionally use ordinary failing assertions for open defects.
They are outside the application's default src/**/*.test.* test selection.

Run from the repository root with installed dependencies and local test-server
binding allowed. These commands use temporary databases or mocked APIs:

Existing module suite and scoped coverage:
  npx vitest run --config qa/cc-receipts/coverage.config.ts --coverage --maxWorkers=1

Accounting acceptance suite (currently exits nonzero on confirmed defects):
  npx vitest run --config qa/cc-receipts/vitest.config.ts

Existing desktop and phone Amex checks:
  npx playwright test e2e/amexCheck.spec.ts

Added desktop and phone receipt checks:
  npx playwright test --config qa/cc-receipts/playwright.config.ts --workers=1

Typecheck and lint the added QA code:
  node node_modules/typescript/bin/tsc -p qa/cc-receipts/tsconfig.json
  node node_modules/eslint/bin/eslint.js --flag unstable_native_nodejs_ts_config qa/cc-receipts/*.ts qa/cc-receipts/browser/*.ts

For saved Vitest JSON evidence, add:
  --reporter=default --reporter=json --outputFile.json=qa/cc-receipts/results/FILE.json

The saved baseline-unit.json and audit-unit.json contain the full final module
and acceptance results. browser.json is emitted by the added Playwright config;
baseline-browser-output.txt records the four existing Amex browser checks.
coverage-summary.json is the scoped coverage snapshot, measured separately on
the existing suite. current-source-snapshot.json fingerprints the final module
files. Baseline and browser reruns are counted once, rather than added together.

build-report.ts compiles the saved evidence, findings.json and priority-cases.json
into the report, CSV files, summary and Excel workbook:
  node qa/cc-receipts/build-report.ts

It has explicit count guards for this dated audit. After fixes or added cases,
review the finding outcomes and update those guards before regenerating a new
report. Do not relabel open accounting failures as expected failures.

Real PostgreSQL multi-connection stress, actual session/JWT validation, S3/CDN
privacy, real OCR, physical camera workflows and owner accounting policies are
listed separately as staging follow-ups. No production records were changed.
