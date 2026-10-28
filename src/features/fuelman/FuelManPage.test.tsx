// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FuelManPage from './FuelManPage';
import AssignmentForm from './forms/AssignmentForm';
import DecisionForm from './forms/DecisionForm';
import { fuelApi } from './api';
import { fixtureReport } from '../../fuelman/testing/fixtures';
import { buildReview } from '../../fuelman/review';
import { ALL_FUEL_MAN_PERMISSIONS, FUEL_MAN as P } from '../../fuelman/permissions';
import type { Assignment, FuelMetadata, ReportDetail } from '../../fuelman/types';
vi.mock('./api', () => ({ fuelApi: { metadata: vi.fn(), revision: vi.fn(), reports: vi.fn(), detail: vi.fn(), command: vi.fn() }, downloadFuel: vi.fn() }));
const meta: FuelMetadata = { global: true, locations: ['Seattle', 'Spokane'], drivers: [{ key: 'user:1', name: 'Driver Alpha', active: true, locations: ['Seattle'], kind: 'user' }], permissions: ALL_FUEL_MAN_PERMISSIONS };
const mapping: Assignment = { id: '1', externalId: 'A', driverKey: 'user:1', driverName: 'Driver Alpha', from: '2026-07-01', to: '', allocations: [{ location: 'Seattle', basisPoints: 10000 }] };
function report(mapped = true): ReportDetail {
  const source = fixtureReport(), { facts: _facts, ...review } = buildReview(source, mapped ? [mapping] : [], [], [], 'snapshot');
  return { id: 'report1', version: 2, revision: 1, company: source.company, month: source.month, start: source.start, end: source.end,
    totalCents: source.totalCents, employeeCount: 1, lineCount: 5, filename: 'report.pdf', status: 'draft', importedAt: '2026-08-01T00:00:00.000Z', importedBy: 'Finance',
    account: source.account, fleet: source.fleet, pageCount: 2, review, warnings: source.warnings, canViewSource: true, priorDateLineCount: 0,
    periodClosed: false, currentPublishedReportId: null, currentPublishedTotalCents: null, currentPublishedRevision: null };
}
beforeEach(() => {
  vi.resetAllMocks(); Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.mocked(fuelApi.metadata).mockResolvedValue(meta); vi.mocked(fuelApi.revision).mockResolvedValue({ revision: 1 });
  vi.mocked(fuelApi.reports).mockResolvedValue({ items: [report()], total: 1, page: 1, limit: 50 }); vi.mocked(fuelApi.detail).mockResolvedValue(report());
});
afterEach(cleanup);
describe('Fuel Man screens', () => {
  it('shows server-calculated branch allocations before approval', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' }));
    await screen.findByText('Ready to approve'); fireEvent.click(screen.getByRole('button', { name: 'Location allocations' }));
    const row = screen.getByRole('cell', { name: /Seattle/ }).closest('tr')!;
    expect(within(row).getByText('$52.50')).toBeTruthy(); expect(within(row).getByText('-$1.00')).toBeTruthy();
    expect(screen.getByText(/Preview only/)).toBeTruthy(); expect(fuelApi.command).not.toHaveBeenCalled();
  });
  it('hides company review actions from branch readers even if their role has import permission', async () => {
    vi.mocked(fuelApi.metadata).mockResolvedValue({ ...meta, global: false });
    render(<FuelManPage />); await screen.findByRole('button', { name: '2026-07 · Revision 1' });
    expect(screen.queryByRole('button', { name: 'Upload reports' })).toBeNull();
  });
  it('disables approval for unresolved drivers and read-only roles', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' }));
    expect((await screen.findByRole('button', { name: 'Approve location expenses' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Assign driver' })).toBeTruthy();
    cleanup(); vi.mocked(fuelApi.metadata).mockResolvedValue({ ...meta, permissions: [P.VIEW] }); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' })); await screen.findByText('Not assigned');
    expect(screen.queryByRole('button', { name: 'Approve location expenses' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Assign driver' })).toBeNull();
  });
  it('retains the original review token and typed note after a stale assignment rejection', async () => {
    const r = report(), onSaved = vi.fn(); vi.mocked(fuelApi.command).mockRejectedValue(Object.assign(new Error('This review changed. Refresh before saving; your form remains open.'), { status: 409 }));
    render(<AssignmentForm report={r} driver={r.review.drivers[0]!} metadata={meta} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment note' }), { target: { value: 'Verified this assignment' } }); fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await screen.findByRole('alert'); expect((screen.getByRole('textbox', { name: 'Assignment note' }) as HTMLTextAreaElement).value).toBe('Verified this assignment');
    expect(fuelApi.command).toHaveBeenCalledWith(r.id, 'assignments', expect.objectContaining({ version: 2, token: r.review.token, note: 'Verified this assignment' })); expect(onSaved).not.toHaveBeenCalled();
  });
  it('requires explicit acknowledgement of pre-statement transactions', async () => {
    const r = { ...report(), priorDateLineCount: 1 }; vi.mocked(fuelApi.command).mockResolvedValue({}); const saved = vi.fn();
    render(<DecisionForm report={r} action="publish" onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Decision note' }), { target: { value: 'Reviewed the late transaction' } });
    const submit = screen.getByRole('button', { name: 'Approve location expenses' }) as HTMLButtonElement; expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); expect(submit.disabled).toBe(false); fireEvent.click(submit);
    await waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(fuelApi.command).toHaveBeenCalledWith(r.id, 'publish', expect.objectContaining({ acknowledgePriorDates: true, token: r.review.token }));
  });
});
