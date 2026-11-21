import { readFile, writeFile } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';
import * as XLSX from 'xlsx';

type Row = Record<string, string | number>;
type Assertion = { title: string; fullName: string; status: string; duration?: number; failureMessages: string[] };
type UnitReport = { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: { name: string; assertionResults: Assertion[] }[] };
type BrowserSuite = { file?: string; title: string; suites?: BrowserSuite[]; specs?: { title: string; file: string; line: number; tests: { projectName: string; results: { status: string; duration: number; error?: { message?: string } }[] }[] }[] };
type Finding = { id: string; priority: string; area: string; title: string; actual: string; expected: string; reproduction: string; impact: string; recommendation: string; source: string };
type PriorityCase = [string, string, string, string, string, string, string];

const here = new URL('./', import.meta.url);
const readJson = async <T>(path: string) => JSON.parse(await readFile(new URL(path, here), 'utf8')) as T;
const stripAnsi = stripVTControlCharacters;
const relative = (path: string) => path.replace(/^.*?Easy-Stones-Website\//, '');
const baseline = await readJson<UnitReport>('results/baseline-unit.json');
const audit = await readJson<UnitReport>('results/audit-unit.json');
const browser = await readJson<{ suites: BrowserSuite[] }>('results/browser.json');
const findings = await readJson<Finding[]>('findings.json');
const definedCases = await readJson<PriorityCase[]>('priority-cases.json');
const coverage = await readJson<{ total: Record<string, { pct: number }> }>('results/coverage-summary.json');

const execution: Row[] = [];
for (const [group, report] of [['Existing unit/API/React', baseline], ['Added accounting acceptance', audit]] as const) {
  for (const file of report.testResults) for (const t of file.assertionResults) {
    execution.push({
      Group: group, Project: 'node / jsdom / isolated DB', Scenario: t.title,
      Suite: t.fullName, Status: t.status.toUpperCase(), 'Duration ms': t.duration ?? 0,
      Source: relative(file.name), 'Failure evidence': stripAnsi(t.failureMessages.join('\n')).slice(0, 20000)
    });
  }
}
const browserRows = (suite: BrowserSuite): void => {
  for (const spec of suite.specs ?? []) for (const t of spec.tests) {
    const last = t.results.at(-1)!;
    const title = spec.title;
    execution.push({
      Group: 'Added browser acceptance', Project: t.projectName, Scenario: title, Suite: spec.title,
      Status: last.status.toUpperCase(), 'Duration ms': last.duration, Source: `${spec.file}:${spec.line}`,
      'Failure evidence': stripAnsi(last.error?.message ?? '')
    });
  }
  for (const child of suite.suites ?? []) browserRows(child);
};
for (const suite of browser.suites) browserRows(suite);

const baselineBrowserOutput = await readFile(new URL('results/baseline-browser-output.txt', here), 'utf8');
for (const match of baselineBrowserOutput.matchAll(/✓\s+\d+\s+\[(desktop|phone)\]\s+›\s+(e2e\/amexCheck.spec.ts:\d+:\d+)\s+›\s+(.+?)\s+\(([\d.]+)s\)/g)) {
  execution.push({
    Group: 'Existing browser checks', Project: match[1]!, Scenario: match[3]!, Suite: match[3]!,
    Status: 'PASSED', 'Duration ms': Math.round(Number(match[4]) * 1000), Source: match[2]!,
    'Failure evidence': ''
  });
}
if (execution.filter(r => r.Group === 'Existing browser checks').length !== 4) throw new Error('Could not recover the four original browser results.');

const priorityCases: Row[] = definedCases.map(([priority, area, scenario, preconditions, steps, expected, selector], i) => {
  const linked = selector === 'NOT RUN' ? [] : execution.filter(r => String(r.Scenario).includes(selector));
  if (selector !== 'NOT RUN' && !linked.length) throw new Error(`Unlinked priority case ${i + 1}: ${selector}`);
  return {
    ID: `TC-${String(i + 1).padStart(3, '0')}`, Priority: priority, Area: area, Scenario: scenario,
    Preconditions: preconditions, Steps: steps, 'Expected result': expected,
    Status: !linked.length ? 'NOT RUN - staging or policy required' : linked.some(r => r.Status === 'FAILED') ? 'FAIL' : 'PASS',
    'Linked executions': linked.length, Evidence: selector === 'NOT RUN' ? 'No execution claimed' : [...new Set(linked.map(r => r.Source))].join('; '),
    'Test selector': selector
  };
});
const counts = (rows: Row[]) => ({ total: rows.length, passed: rows.filter(r => r.Status === 'PASSED').length, failed: rows.filter(r => r.Status === 'FAILED').length });
const original = counts(execution.filter(r => String(r.Group).startsWith('Existing')));
const added = counts(execution.filter(r => String(r.Group).startsWith('Added')));
const total = counts(execution);
if (total.total !== 297 || total.failed !== 19 || findings.length !== 12) throw new Error(`Unexpected run summary: ${JSON.stringify(total)}`);
const manual = priorityCases.filter(r => String(r.Status).startsWith('NOT RUN'));
const summary: Row[] = [
  { Metric: 'Report date / timezone', Value: '2026-11-21 / America/Los_Angeles (testing began November 20)' },
  { Metric: 'Disposition', Value: 'Do not sign off for accounting use until failed controls are resolved and retested.' },
  { Metric: 'Existing checks (unit/API/React + browser)', Value: `${original.passed}/${original.total} passed` },
  { Metric: 'Added acceptance checks', Value: `${added.total}: ${added.passed} passed; ${added.failed} failed` },
  { Metric: 'Unique executed cases including both browser projects', Value: `${total.total}: ${total.passed} passed; ${total.failed} failed` },
  { Metric: 'Grouped findings', Value: `${findings.length}: 1 P0, ${findings.filter(f => f.priority === 'P1').length} P1, 2 P2` },
  { Metric: 'Curated high-value test cases', Value: priorityCases.length },
  { Metric: 'Curated cases requiring staging / policy', Value: manual.length },
  { Metric: 'Existing-suite statement coverage (selected module files)', Value: `${coverage.total.statements!.pct}%` },
  { Metric: 'Existing-suite branch coverage (selected module files)', Value: `${coverage.total.branches!.pct}%` },
  { Metric: 'Coverage scope', Value: 'Defined in coverage.config.ts; measured on the existing 162 checks, not on the new failing acceptance suite.' },
  { Metric: 'Typecheck', Value: 'tsc -p qa/cc-receipts/tsconfig.json passed' },
  { Metric: 'Application source changes by this audit', Value: 'None; only QA fixtures, cases, tests and reports were added. Concurrent receipt-view and branch-fallback edits were preserved.' },
  { Metric: 'Live systems', Value: 'No production database writes, real OCR calls, emails or live S3 tests.' }
];
const defectRows: Row[] = findings.map(f => ({
  ID: f.id, Priority: f.priority, Area: f.area, Finding: f.title, 'Observed result': f.actual,
  'Expected result': f.expected, Reproduction: f.reproduction, 'Accounting impact': f.impact,
  'Suggested correction': f.recommendation, 'Source location': f.source
}));
const csvOf = (rows: Row[]) => {
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n') + '\n';
};
await writeFile(new URL('test-cases.csv', here), csvOf(priorityCases));
await writeFile(new URL('results/execution.csv', here), csvOf(execution));
await writeFile(new URL('results/summary.json', here), JSON.stringify({ date: '2026-11-21', testingBegan: '2026-11-20', timezone: 'America/Los_Angeles', original, added, total, findings: findings.length, priorityCases: priorityCases.length, notRunCases: manual.length, coverage: coverage.total }, null, 2) + '\n');

const workbook = XLSX.utils.book_new();
for (const [name, rows] of [['Summary', summary], ['Defects', defectRows], ['Priority test cases', priorityCases], ['All executions', execution], ['Staging follow-up', manual]] as const) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const keys = Object.keys(rows[0]!);
  sheet['!cols'] = keys.map(k => ({ wch: /Steps|result|Scenario|Reproduction|Finding|impact|correction|evidence|Suite|Value/.test(k) ? 65 : /Source|Evidence|Preconditions/.test(k) ? 50 : 22 }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}
await writeFile(new URL('CC-Receipts-QA.xlsx', here), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

const report = [
  'CC RECEIPTS — ACCOUNTING QA REPORT',
  'Test window: November 20–21, 2026 (America/Los_Angeles)',
  '',
  'RESULT: Accounting sign-off is not recommended yet. The original regression tests pass, but additional adverse-condition testing found failures in approval, ownership, duplicate protection and reconciliation controls.',
  '',
  ...summary.map(r => `${r.Metric}: ${r.Value}`),
  '',
  'How to use the workbook',
  'CC-Receipts-QA.xlsx contains Summary, Defects, Priority test cases, All executions and Staging follow-up sheets. test-cases.csv contains the same curated cases with preconditions, steps, expected result, measured status and source references. results/execution.csv lists every counted automated execution. A passing regression suite is not a claim of accounting correctness.',
  '',
  'Scope and method',
  'Covered receipt creation/edit/draft/send-back/void, card and category administration, subcategories, role and branch visibility, private receipt access, OCR handling with test doubles, one- and two-step approval, duplicate detection/idempotency, Amex parsing/import/matching, exact-cent totals and Excel downloads, write pauses, rollback and 5,001-row volume behavior.',
  'Existing tests ran against their temporary MongoDB/PGlite databases and React fixtures. Added API tests use the real Express routers and schema migrations with an isolated PGlite database. The staff directory and authentication boundary are doubles; actual JWT/session behavior was not verified. File storage and OCR in these tests are doubles.',
  'Concurrency tests gate requests just before the real persistence adapter to reproduce specific check-then-write interleavings. PGlite serializes transactions and is not a substitute for independent PostgreSQL connections, worker processes, pool contention or a deployment stress test. A passing same-ID concurrent test does not prove the PostgreSQL primary-key race path is safe.',
  'Browser tests use desktop Chromium and an emulated Pixel 7, with mocked API boundaries. The downloaded Excel files were read back to verify totals, filtering, void exclusion and text cell types. Physical phone cameras, Safari/iOS, real OCR and live S3/CDN behavior remain unverified.',
  'The 5,001-row check verifies ledger completeness and exercises volume locally. No performance SLO, sustained-load reliability, security certification or accounting/legal compliance claim is made.',
  'Concurrent edits to the receipt view and branch fallback were observed and preserved. Final checks were rerun after those edits. A parallel verification attempt hit temporary MongoDB/PGlite startup and browser timeouts; those incomplete attempts were excluded from the accounting defect counts and retried with reduced concurrency.',
  'Amounts, statuses and approval rules were taken from repository code and existing tests. Subtotal, tax and tip are documented as informational; no invented sum-equality rule was imposed. Period close, currency, retention and exception policy questions are listed as NOT RUN/owner decisions.',
  '',
  'Findings (reproducible; production behavior was not modified)',
  ...findings.flatMap(f => [
    '', `${f.id} [${f.priority}] ${f.title}`, `Observed: ${f.actual}`, `Expected: ${f.expected}`,
    `Reproduce: ${f.reproduction}`, `Impact: ${f.impact}`, `Correction: ${f.recommendation}`, `Code: ${f.source}`
  ]),
  '',
  'Checks that passed',
  'All 162 original module unit/API/React/database parity checks and four original desktop/phone browser checks passed. Added checks confirmed ordinary permission denials, immutable approved receipts in sequential use, self-approval denial, the exact $150 threshold, distinct approvers, required lost-receipt comments, step-one reset after edit, sequential save retries, explicit duplicate overrides, private file access, previews/failed-import rollback, repeated import idempotency, two-day matching boundaries, refunds, audit-write rollback, migration write pauses, upload limits, file selection errors, save-error input preservation and real downloaded workbook contents.',
  '',
  'Coverage',
  `Existing-suite selected-module V8 coverage: statements ${coverage.total.statements!.pct}%, branches ${coverage.total.branches!.pct}%, functions ${coverage.total.functions!.pct}%, lines ${coverage.total.lines!.pct}%. These are execution metrics, not proof that financial invariants hold. See coverage.config.ts and results/coverage-summary.json for scope and per-file values.`,
  '',
  'Release/retest order',
  '1. Fix CC-07 atomic approval/state transitions and retest all three races, including the $200 one-approval bypass.',
  '2. Fix CC-12 ownership fallback, CC-08 concurrent duplicates and CC-09 protected mutations during lookup failure.',
  '3. Fix reconciliation evidence/counts (CC-03), changed-reference matches (CC-04), customer/category integrity (CC-05/06) and full-ledger/export completeness (CC-11).',
  '4. Fix amount parsing (CC-01), resolve strict-date policy (CC-02), and show queue-load failures (CC-10).',
  '5. Run the acceptance suites until all required invariants pass; then execute staging follow-ups with real identities, database connections, file storage and OCR, using synthetic accounting data.',
  '',
  'Reproduction commands (from repository root)',
  'npx vitest run --config qa/cc-receipts/coverage.config.ts --coverage',
  'npx vitest run --config qa/cc-receipts/vitest.config.ts',
  'npx playwright test e2e/amexCheck.spec.ts',
  'npx playwright test --config qa/cc-receipts/playwright.config.ts',
  'node node_modules/typescript/bin/tsc -p qa/cc-receipts/tsconfig.json',
  '',
  'Acceptance-suite failures are intentional evidence of unfixed controls, with ordinary failing assertions. They are opt-in under qa/ and do not change the default test include pattern. No test was marked expected-to-fail to hide a defect.',
  'Duplicate verification attempts and the coverage rerun are not double-counted. The report counts each unit test and each browser scenario/project combination once, using the final completed module runs.',
  'Captured evidence is in results/: original and acceptance JSON reports, full browser JSON, coverage summary and screenshots approval-queue-error-desktop.png / approval-queue-error-phone.png.',
  'This report remains a dated test snapshot. To refresh the artifacts after rerunning suites, replace the stored JSON inputs and run node qa/cc-receipts/build-report.ts; its count guards deliberately require review when execution counts change.'
];
await writeFile(new URL('REPORT.txt', here), report.join('\n') + '\n');
console.log(JSON.stringify({ original, added, total, findings: findings.length, priorityCases: priorityCases.length, notRunCases: manual.length, report: 'qa/cc-receipts/REPORT.txt', workbook: 'qa/cc-receipts/CC-Receipts-QA.xlsx' }, null, 2));
