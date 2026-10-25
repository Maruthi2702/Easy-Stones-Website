// @vitest-environment jsdom
// The customer imports render: Import from SPS (upload, a file's check, the
// names to answer, the review of a saved draft, a running import, the results,
// the history), Connect customers to SPS (upload, dry run, review), and the old
// Excel import (first step, preview, review tab). The API is a fake keyed on the URL.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

let mode = 'none';
const plan = (review: boolean) => ({
  run: { id: 'R1' }, mapping: { company: 'Name' }, headers: ['Name', 'Rep'],
  unresolvedReps: review ? [] : [{ given: 'Bobby', rowCount: 2 }], unresolvedBranches: [], reps: [{ _id: 'u2', name: 'Rita' }], branches: ['Seattle'],
  blockers: review ? [] : ['1 name left'], needs: {}, fileCheck: { ok: true, rowsRead: 3, blocking: [], warnings: [] },
  rowsRead: 3, distinct: 3, skipped: { blank: 0, repeated: 0 }, counts: { decision: 1, new: 1, unchanged: 1 },
  rows: { decision: [{ key: 'pg', name: 'PG LLC', rowNumber: 2, sheet: { company: 'PG LLC' }, matches: [{ id: 'c1', company: 'Pacific Granite', signals: ['phone'] }] }],
    new: [{ key: 'n', name: 'Harbor Stone' }], unchanged: [{ key: 's', name: 'Kent Marble' }] }
});
const run = (status: string) => ({ id: 'R2', status, done: status === 'done' ? 3 : 1, total: 3, results: { added: 1, updated: 0, unchanged: 2 }, createdBy: 'Krish',
  verify: status === 'done' ? { ok: true, present: 3, expected: 3, missingCount: 0, missing: [] } : undefined });
const routes: [RegExp, () => unknown][] = [
  [/sps-import\/runs\/current/, () => ({ draft: mode === 'draft' ? { id: 'R1', fileName: 'f.xls', answered: 1 } : null, running: mode === 'running' || mode === 'done' ? run('running') : null })],
  [/sps-import\/runs\/R1\/plan/, () => plan(mode === 'draft')],
  [/sps-import\/runs\/R2\/items/, () => ({ items: [{ rowNumber: 2, name: 'Harbor Stone', result: 'added', added: {}, changes: [], warnings: [] }], total: 1 })],
  [/sps-import\/runs\/R2/, () => ({ run: run(mode === 'done' ? 'done' : 'running') })],
  [/sps-import\/runs$/, () => ({ run: { id: 'R1', fileName: 'f.xls' }, fileCheck: { ok: true, rowsRead: 3, blocking: [], warnings: [] }, runs: [{ ...run('done'), fileName: 'f.xls' }] })],
  [/sps-connect\/preview/, () => ({ total: 10, connected: 5, notInSps: 0, autoCount: mode === 'review' ? 0 : 4, spsRows: 12, spsUnclaimed: 2, autoSample: [{ customerId: 'c1', company: 'PG', spsName: 'PG' }],
    toCheck: [{ customerId: 'c9', company: 'Harbor Floors', candidates: [{ key: 'hf', name: 'Harbor Floors Inc', signals: ['phone'] }] }] })],
  [/import\/preview/, () => ({ mapping: { company: 'Name' }, headers: ['Name'], fileCheck: { ok: true, rowsRead: 2, blocking: [], warnings: [] }, counts: { create: 1, update: 0, review: 1, unchanged: 0, error: 0 },
    rows: [{ rowNumber: 2, action: 'create', company: 'Harbor Stone', create: {} }, { rowNumber: 3, action: 'review', company: 'PG LLC', reason: 'Looks like', matches: [{ id: 'c1', label: 'Pacific Granite', signals: ['phone'] }] }],
    dbDuplicates: [] })],
];
const answer = (url: string) => {
  const hit = routes.find(([re]) => re.test(String(url)));
  return Promise.resolve(new Response(JSON.stringify(hit ? hit[1]() : []), { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
vi.mock('../../../api/authFetch', () => ({ authFetch: (u: string) => answer(u) }));

const { default: SpsImportModal } = await import('./SpsImportModal');
const { default: SpsConnectModal } = await import('./SpsConnectModal');
const { default: CustomerImportModal } = await import('./CustomerImportModal');
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
const pick = async (sel = 'input[type="file"]') => {
  fireEvent.change(document.querySelector(sel) as Element, { target: { files: [new File(['x'], 'f.xls')] } });
  await settle();
};
const press = async (text: string) => { fireEvent.click(screen.getByText(text)); await settle(); };
const sps = { onClose() {}, salesReps: [{ _id: 'u2', name: 'Rita', location: 'Seattle' }], locations: ['Seattle'], canEdit: true, canAdd: true, canDelete: true };

afterEach(() => { cleanup(); mode = 'none'; });

describe('Import from SPS', () => {
  it('opens on the upload step, then checks a file and asks for the names', async () => {
    render(<SpsImportModal {...sps} />);
    await settle();
    expect(screen.getByText('Choose the SPS customer export')).toBeTruthy();
    await pick();
    expect(screen.getByText('File check')).toBeTruthy();
    await press('Continue');
    expect(screen.getByText('Bobby')).toBeTruthy();
    expect(document.body.textContent).toContain('1 name left to answer');
  });
  it('continues a saved draft to the review', async () => {
    mode = 'draft';
    render(<SpsImportModal {...sps} />);
    await settle();
    expect(screen.getByText('You have an import in progress')).toBeTruthy();
    // Every name in the draft's plan is answered, so it lands on the review.
    await press('Continue it');
    expect(screen.getByText('Same customer: Pacific Granite')).toBeTruthy();
    expect(screen.getByText('Download plan (CSV)')).toBeTruthy();
    fireEvent.click(screen.getByText('New 1'));
    expect(screen.getByText('Harbor Stone')).toBeTruthy();
  });
  it('shows a running import, then its results', async () => {
    mode = 'running';
    render(<SpsImportModal {...sps} />);
    await settle();
    expect(document.body.textContent).toContain('Importing…');
    cleanup();
    mode = 'done';
    render(<SpsImportModal {...sps} />);
    await settle();
    expect(screen.getByText('✓ Every SPS customer is accounted for')).toBeTruthy();
    expect(screen.getByText('Harbor Stone')).toBeTruthy();
    expect(screen.getByText('Undo this import')).toBeTruthy();
  });
  it('opens the history', async () => {
    render(<SpsImportModal {...sps} />);
    await settle();
    await press('Import history');
    expect(screen.getByText('SPS import history')).toBeTruthy();
    expect(screen.getByText('✓ All 3 accounted for')).toBeTruthy();
  });
});

describe('Connect customers to SPS', () => {
  it('checks the file and shows the dry run', async () => {
    render(<SpsConnectModal onClose={() => {}} />);
    expect(screen.getByText('Check the file')).toBeTruthy();
    await pick();
    await press('Check the file');
    expect(screen.getByText(/This is a dry run/)).toBeTruthy();
    expect(screen.getByText('Connect 4 customers')).toBeTruthy();
  });
  it('goes straight to the review when nothing connects by name', async () => {
    mode = 'review';
    render(<SpsConnectModal onClose={() => {}} />);
    await pick();
    await press('Check the file');
    expect(screen.getByText('Skip for now')).toBeTruthy();
    fireEvent.click(document.querySelectorAll('.spsc-opt input')[0]);
    expect(screen.getByText('Save 1 answer')).toBeTruthy();
  });
});

describe('Import from Excel', () => {
  it('previews a file and lists the rows to review', async () => {
    render(<CustomerImportModal show onClose={() => {}} />);
    expect(screen.getByText('Choose your SPS export (.xlsx or .xls)')).toBeTruthy();
    await pick();
    expect(screen.getByText('Which column is which')).toBeTruthy();
    expect(screen.getByText('Import 1 row')).toBeTruthy();
    fireEvent.click(screen.getByText('Needs your review (1)'));
    expect(screen.getByText('Looks like')).toBeTruthy();
  });
  it('renders nothing while hidden', () => {
    render(<CustomerImportModal show={false} onClose={() => {}} />);
    expect(document.body.innerHTML).toBe('<div></div>');
  });
});
