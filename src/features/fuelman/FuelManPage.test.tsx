// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FuelManPage from './FuelManPage';
import AssignmentForm from './forms/AssignmentForm';
import DecisionForm from './forms/DecisionForm';
import SetupDriversForm from './forms/SetupDriversForm';
import { fuelApi } from './api';
import { fixtureReport } from '../../fuelman/testing/fixtures';
import { buildReview } from '../../fuelman/review';
import { ALL_FUEL_MAN_PERMISSIONS, FUEL_MAN as P } from '../../fuelman/permissions';
import type { Assignment, FuelMetadata, ReportDetail } from '../../fuelman/types';
vi.mock('./api', () => ({ fuelApi: { metadata: vi.fn(), revision: vi.fn(), reports: vi.fn(), detail: vi.fn(), command: vi.fn() }, downloadFuel: vi.fn() }));
const meta: FuelMetadata = { global: true, locations: ['Seattle', 'Spokane'], drivers: [{ key: 'user:1', name: 'Driver Alpha', active: true, locations: ['Seattle'], kind: 'user' }], permissions: ALL_FUEL_MAN_PERMISSIONS };
const mapping: Assignment = { id: '1', externalId: 'A', driverKey: 'user:1', driverName: 'Driver Alpha', from: '2026-07-01', to: '', allocations: [{ location: 'Seattle', basisPoints: 10000 }] };
function report(mapped = true, ids = ['A']): ReportDetail {
  const source = fixtureReport('2026-07', ids), { facts: _facts, ...review } = buildReview(source, mapped ? [mapping] : [], [], [], 'snapshot');
  return { id: 'report1', version: 2, revision: 1, company: source.company, month: source.month, start: source.start, end: source.end,
    totalCents: source.totalCents, employeeCount: source.employees.length, lineCount: source.lines.length, filename: 'report.pdf', status: 'draft', importedAt: '2026-08-01T00:00:00.000Z', importedBy: 'Finance',
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
  it('shows saved driver matches without asking for monthly setup again', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' }));
    await screen.findByText('Saved match'); expect(screen.getByText(/Saved driver matches carry forward each month/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign locations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign driver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeTruthy();
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
  it('shows uploaded driver expenses and the unassigned total before any location is chosen', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' }));
    await screen.findByText('Awaiting locations'); expect(screen.getByRole('button', { name: 'Driver Alp' })).toBeTruthy();
    expect(screen.getByText('1 drivers need a location')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Location totals' }));
    await screen.findByText('2026-07 · Draft location totals');
    const row = screen.getByRole('cell', { name: /Unassigned/ }).closest('tr')!;
    expect(within(row).getByText('$52.50')).toBeTruthy(); expect(fuelApi.command).not.toHaveBeenCalled();
  });
  it('sets up driver locations in one form with a backend command and preserves input on a stale review', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false));
    vi.mocked(fuelApi.command).mockRejectedValue(new Error('This review changed. Refresh before saving.'));
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: '2026-07 · Revision 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Assign locations' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Driver from Users & Roles' }));
    fireEvent.click(screen.getByRole('option', { name: /Driver Alpha/ }));
    expect(screen.queryByText('Create expense profile from report')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use one location for this group' }));
    fireEvent.click(screen.getByRole('option', { name: 'Seattle' })); fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to all 1 drivers' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assignment note' }), { target: { value: 'Confirmed location' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 1 assignments' })); await screen.findByRole('alert');
    expect(fuelApi.command).toHaveBeenCalledWith('report1', 'assignments/batch', expect.objectContaining({ token: report(false).review.token, assignments: [expect.objectContaining({ externalId: 'A', driverKey: 'user:1', allocations: [{ location: 'Seattle', percent: '100' }] })] }));
    expect((within(dialog).getByRole('textbox', { name: 'Assignment note' }) as HTMLTextAreaElement).value).toBe('Confirmed location');
  });
  it('offers existing Driver users, excludes standalone expense profiles and fills an unambiguous profile location', async () => {
    const r = report(false);
    render(<AssignmentForm report={r} driver={r.review.drivers[0]!} metadata={{ ...meta, drivers: [...meta.drivers, { key: 'profile:legacy', name: 'Legacy expense', active: true, locations: [], kind: 'profile' }] }} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Driver from Users & Roles' }));
    expect(screen.queryByRole('option', { name: /Legacy expense|New driver|Create expense profile/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Driver Alpha/ }));
    expect(screen.getByRole('button', { name: 'Cost location' }).textContent).toContain('Seattle');
    expect(screen.queryByRole('textbox', { name: 'Profile name' })).toBeNull();
  });
  it('saves confirmed Driver-user matches while leaving unmatched report rows pending', async () => {
    vi.mocked(fuelApi.command).mockResolvedValue({}); const saved = vi.fn(), r = report(false, ['A', 'B']);
    render(<SetupDriversForm report={r} metadata={meta} onClose={vi.fn()} onSaved={saved} />);
    expect((screen.getByRole('button', { name: 'Save assignments' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Driver from Users & Roles' })[0]!);
    fireEvent.click(screen.getByRole('option', { name: /Driver Alpha/ }));
    expect((screen.getByRole('textbox', { name: 'Assignment note' }) as HTMLTextAreaElement).required).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 assignments' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const body = vi.mocked(fuelApi.command).mock.calls[0]![2] as { note: string; assignments: { externalId: string; driverKey: string }[] };
    expect(body.note).toBe(''); expect(body.assignments).toHaveLength(1); expect(body.assignments[0]).toMatchObject({ externalId: 'A', driverKey: 'user:1' });
  });
  it('retains the original review token and typed note after a stale assignment rejection', async () => {
    const r = report(), onSaved = vi.fn(); vi.mocked(fuelApi.command).mockRejectedValue(Object.assign(new Error('This review changed. Refresh before saving; your form remains open.'), { status: 409 }));
    render(<AssignmentForm report={r} driver={r.review.drivers[0]!} metadata={meta} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Assignment note' }), { target: { value: 'Verified this assignment' } }); fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await screen.findByRole('alert'); expect((screen.getByRole('textbox', { name: 'Assignment note' }) as HTMLTextAreaElement).value).toBe('Verified this assignment');
    expect(fuelApi.command).toHaveBeenCalledWith(r.id, 'assignments', expect.objectContaining({ version: 2, token: r.review.token, note: 'Verified this assignment' })); expect(onSaved).not.toHaveBeenCalled();
  });
  it('saves an individual driver assignment with a blank optional note', async () => {
    const r = report(), saved = vi.fn(); vi.mocked(fuelApi.command).mockResolvedValue({});
    render(<AssignmentForm report={r} driver={r.review.drivers[0]!} metadata={meta} onClose={vi.fn()} onSaved={saved} />);
    expect((screen.getByRole('textbox', { name: 'Assignment note' }) as HTMLTextAreaElement).required).toBe(false);
    expect((screen.getByRole('button', { name: 'Save assignment' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(fuelApi.command).toHaveBeenCalledWith(r.id, 'assignments', expect.objectContaining({ note: '' }));
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
