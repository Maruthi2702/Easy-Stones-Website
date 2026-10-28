// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FuelManPage from './FuelManPage';
import AssignmentForm from './forms/AssignmentForm';
import ClassificationForm from './forms/ClassificationForm';
import DecisionForm from './forms/DecisionForm';
import SetupDriversForm from './forms/SetupDriversForm';
import { fuelApi } from './api';
import { fixtureReport } from '../../fuelman/testing/fixtures';
import { buildReview } from '../../fuelman/review';
import { ALL_FUEL_MAN_PERMISSIONS, FUEL_MAN as P } from '../../fuelman/permissions';
import type { Assignment, FuelMetadata, ReportDetail } from '../../fuelman/types';
vi.mock('./api', () => ({ fuelApi: { metadata: vi.fn(), revision: vi.fn(), reports: vi.fn(), detail: vi.fn(), command: vi.fn(), lines: vi.fn() }, downloadFuel: vi.fn() }));
const meta: FuelMetadata = { global: true, locations: ['Seattle', 'Spokane'], drivers: [{ key: 'user:1', name: 'Driver Alpha', active: true, locations: ['Seattle'], kind: 'user' }], permissions: ALL_FUEL_MAN_PERMISSIONS };
const mapping: Assignment = { id: '1', externalId: 'A', driverKey: 'user:1', driverName: 'Driver Alpha', from: '2026-07-01', to: '', allocations: [{ location: 'Seattle', basisPoints: 10000 }] };
const REPORT_ID = 'abcdef012345678901234567';
function report(mapped = true, ids = ['A']): ReportDetail {
  const source = fixtureReport('2026-07', ids), { facts: _facts, ...review } = buildReview(source, mapped ? [mapping] : [], [], [], 'snapshot');
  return { compare: null, id: REPORT_ID, version: 2, revision: 1, company: source.company, month: source.month, start: source.start, end: source.end,
    totalCents: source.totalCents, employeeCount: source.employees.length, lineCount: source.lines.length, filename: 'report.pdf', status: 'draft', importedAt: '2026-08-01T00:00:00.000Z', importedBy: 'Finance',
    account: source.account, fleet: source.fleet, pageCount: 2, review, warnings: source.warnings, canViewSource: true, priorDateLineCount: 0,
    periodClosed: false, currentPublishedReportId: null, currentPublishedTotalCents: null, currentPublishedRevision: null };
}
beforeEach(() => {
  vi.resetAllMocks(); Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.mocked(fuelApi.lines).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
  vi.mocked(fuelApi.metadata).mockResolvedValue(meta); vi.mocked(fuelApi.revision).mockResolvedValue({ revision: 1 });
  vi.mocked(fuelApi.reports).mockResolvedValue({ items: [report()], total: 1, page: 1, limit: 50 }); vi.mocked(fuelApi.detail).mockResolvedValue(report());
});
afterEach(cleanup);
const OPEN = { name: 'July 2026' };
/** A draft opens on the one-page summary; the full tabbed review is behind Details. */
async function openDetails() { fireEvent.click(await screen.findByRole('button', { name: 'Details' })); await screen.findByRole('tablist', { name: 'Report review views' }); }
describe('Fuel Man screens', () => {
  it('shows server-calculated branch allocations before approval', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    await screen.findByText('Ready to approve'); fireEvent.click(screen.getByRole('tab', { name: 'Location allocations' }));
    const row = screen.getByRole('cell', { name: /Seattle/ }).closest('tr')!;
    expect(within(row).getByText('$52.50')).toBeTruthy(); expect(within(row).getByText('-$1.00')).toBeTruthy();
    expect(screen.getByText(/Preview only/)).toBeTruthy(); expect(fuelApi.command).not.toHaveBeenCalled();
  });
  it('shows saved driver matches without asking for monthly setup again', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    await screen.findByText('Saved match'); expect(screen.getByText(/Saved driver matches carry forward each month/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign locations' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign driver' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeTruthy();
  });
  it('keeps the open report and tab in the address, and Back returns to the list', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    await screen.findByText('Ready to approve');
    expect(window.location.search).toContain(`fm_report=${REPORT_ID}`);
    fireEvent.click(screen.getByRole('tab', { name: 'Location allocations' }));
    expect(window.location.search).toContain('fm_tab=allocations');
    window.history.back(); // the tab change replaced the report's entry, so Back leaves the report
    await waitFor(() => expect(window.location.search).not.toContain('fm_report'));
    await screen.findByRole('button', { name: 'July 2026' });
  });
  it('shows the steps to approve and lands on drivers that need attention first', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    const steps = await screen.findByRole('list', { name: 'Steps to approve this report' });
    expect(within(steps).getByText('Match drivers')).toBeTruthy(); expect(within(steps).getByText('Not yet')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Needs attention only' }) as HTMLInputElement).checked).toBe(true);
  });
  it('announces the selected tab and moves between tabs with the arrow keys', async () => {
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    const drivers = await screen.findByRole('tab', { name: 'Drivers' });
    expect(drivers.getAttribute('aria-selected')).toBe('true'); expect(screen.getByRole('tab', { name: 'Missing drivers' }).getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(drivers, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Missing drivers' }).getAttribute('aria-selected')).toBe('true'));
  });
  it('lists what each location will carry in the approval dialog', async () => {
    render(<DecisionForm report={report()} action="publish" onClose={() => {}} onSaved={() => {}} />);
    const table = screen.getByRole('table'); expect(within(table).getByText('Seattle')).toBeTruthy(); expect(within(table).getAllByText('$52.50').length).toBeGreaterThan(0);
  });
  it('classifies several unknown charges together with one category and note', async () => {
    const lines = [{ index: 3, externalId: 'A', date: '2026-07-04', amountCents: 1200, page: 2, description: 'Misc', category: 'other' }, { index: 4, externalId: 'A', date: '2026-07-05', amountCents: 800, page: 2, description: 'Misc 2', category: 'other' }] as never;
    vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
    render(<ClassificationForm report={report()} lines={lines} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(/2 charges totalling \$20.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expense category' })); fireEvent.click(screen.getByRole('option', { name: 'Supplies' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Why this category/ }), { target: { value: 'Shop supplies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for 2 charges' }));
    await waitFor(() => expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'classifications', expect.objectContaining({ rows: [{ index: 3, category: 'supplies', note: 'Shop supplies' }, { index: 4, category: 'supplies', note: 'Shop supplies' }] })));
  });
  describe('monthly review page', () => {
    it('accepts a clear name match in one tap, saving the driver and home location', async () => {
      vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      await screen.findByText('Needs a look · 1'); expect(screen.getByText(/Looks like Driver Alpha, home location Seattle/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, Driver Alpha → Seattle' }));
      await waitFor(() => expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'assignments/batch', expect.objectContaining({
        assignments: [expect.objectContaining({ externalId: 'A', driverKey: 'user:1', allocations: [{ location: 'Seattle', percent: '100' }] })] })));
      expect((screen.getByRole('button', { name: /to check|Approve/ }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('answers a missing driver with one button and sends a reason and note', async () => {
      const source = fixtureReport('2026-07', ['A']), absent = { ...mapping, id: '2', externalId: 'B', driverKey: 'user:2', driverName: 'Driver Beta' };
      const { facts: _f, ...review } = buildReview(source, [mapping, absent], [], [], 'snapshot'), r = { ...report(), review };
      vi.mocked(fuelApi.detail).mockResolvedValue(r); vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      await screen.findByText('Driver Beta had no charges'); fireEvent.click(screen.getByRole('button', { name: 'On leave' }));
      await waitFor(() => expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'missing', expect.objectContaining({ externalId: 'B', reason: 'leave', note: expect.stringContaining('On leave') })));
    });
    it('sorts a group of alike unknown charges together', async () => {
      const line = (index: number, d: string) => ({ index, externalId: 'A', date: '2026-07-0' + index, time: '10:00', description: `07/0${index} 10:00 Car wash ${d}`, amountCents: 1400, category: 'other', page: 2, vehicle: 'T1', site: '1', exceptionCodes: [] });
      vi.mocked(fuelApi.lines).mockResolvedValue({ items: [line(1, '$14.00'), line(2, '$14.00')] as never, total: 2, page: 1, limit: 100 }); vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      await screen.findByText(/“Car wash”/); fireEvent.click(screen.getByRole('button', { name: 'Supplies' }));
      await waitFor(() => expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'classifications', expect.objectContaining({ rows: [expect.objectContaining({ index: 1, category: 'supplies' }), expect.objectContaining({ index: 2, category: 'supplies' })] })));
    });
    it('offers approval only when nothing is left, and shows the change from last month', async () => {
      const r = { ...report(), compare: { previousMonth: '2026-06', previousTotalCents: 4000, carriedOverCount: 1, locations: [{ location: 'Seattle', previousCents: 4000 }] } };
      vi.mocked(fuelApi.detail).mockResolvedValue(r); render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      const approve = await screen.findByRole('button', { name: 'Approve July 2026' }); expect((approve as HTMLButtonElement).disabled).toBe(false);
      expect(screen.getByText(/31.3% vs June 2026/)).toBeTruthy(); expect(screen.getByText('Nothing needs a look')).toBeTruthy();
      fireEvent.click(approve); expect(await screen.findByRole('dialog')).toBeTruthy();
    });
    it('walks a first month step by step: cards with suggestions, one batch save for the ready ones', async () => {
      const ids = Array.from({ length: 10 }, (_, n) => `D${n}`); vi.mocked(fuelApi.detail).mockResolvedValue(report(false, ids));
      vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      expect(await screen.findByText('Who is each card?')).toBeTruthy(); expect(screen.queryByText(/Needs a look/)).toBeNull();
      const steps = screen.getByRole('list', { name: 'Steps to approve' }); expect(within(steps).getByText('Match drivers')).toBeTruthy();
      expect(screen.getAllByText('Employee #D3 · $52.50 this month').length).toBe(1);
      fireEvent.click(screen.getByRole('button', { name: 'Next: explain absences' })); expect(await screen.findByText("Who didn't fuel this month?")).toBeTruthy();
      fireEvent.click(within(steps).getByRole('button', { name: /Approve/ })); expect(await screen.findByText('Check the totals, then approve')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Some steps are not done' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('tells a card with no suggestion what it needs, then that it is ready once a driver is chosen (their home location fills in)', async () => {
      const ids = Array.from({ length: 10 }, (_, n) => `D${n}`); vi.mocked(fuelApi.detail).mockResolvedValue(report(false, ids));
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      const card = (await screen.findByText('Employee #D3 · $52.50 this month')).closest('article')!;
      expect(within(card).getByText('Choose a driver', { selector: '.fuel-status' })).toBeTruthy();
      fireEvent.click(within(card).getByLabelText('Driver')); fireEvent.click(await screen.findByRole('option', { name: /Driver Alpha/ }));
      expect(within(card).getByText('Ready to save')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Save 1 match' })).toBeTruthy();
      fireEvent.click(within(card).getByLabelText('Charge to')); fireEvent.click(await screen.findByRole('option', { name: /Spokane/ }));
      expect(within(card).getByText('Ready to save')).toBeTruthy();
    });
    it('accepts a clear suggestion on a first-month card with one tap', async () => {
      const ids = ['A', ...Array.from({ length: 9 }, (_, n) => `D${n}`)]; vi.mocked(fuelApi.detail).mockResolvedValue(report(false, ids));
      vi.mocked(fuelApi.command).mockResolvedValue({ success: true });
      render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', OPEN));
      fireEvent.click((await screen.findAllByRole('button', { name: 'Accept' }))[0]!);
      await waitFor(() => expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'assignments/batch', expect.objectContaining({ assignments: [expect.objectContaining({ externalId: 'A', driverKey: 'user:1' })] })));
    });
  });
  it('puts the month that needs you first, says what to do next, and tells later months to wait', async () => {
    const june = { ...report(), id: 'aaaaaaaaaaaaaaaaaaaaaaaa', month: '2026-06' }, july = { ...report(), month: '2026-07' };
    vi.mocked(fuelApi.reports).mockResolvedValue({ items: [july, june] as never, total: 2, page: 1, limit: 50 });
    vi.mocked(fuelApi.detail).mockImplementation(async id => (id === june.id ? { ...report(false), id, month: '2026-06' } : report()));
    render(<FuelManPage />);
    const hero = await screen.findByRole('region', { name: 'Month that needs you' });
    expect(within(hero).getByText('June 2026')).toBeTruthy(); await within(hero).findByText('Next: match 1 driver');
    expect(screen.getByText('Review June 2026 first')).toBeTruthy(); expect(screen.getByText('Choose PDF files')).toBeTruthy();
  });
  it('hides company review actions from branch readers even if their role has import permission', async () => {
    vi.mocked(fuelApi.metadata).mockResolvedValue({ ...meta, global: false });
    render(<FuelManPage />); await screen.findByRole('button', { name: 'July 2026' });
    expect(screen.queryByRole('button', { name: 'Upload reports' })).toBeNull();
  });
  it('disables approval for unresolved drivers and read-only roles', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    expect((await screen.findByRole('button', { name: 'Approve location expenses' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Assign driver' })).toBeTruthy();
    cleanup(); vi.mocked(fuelApi.metadata).mockResolvedValue({ ...meta, permissions: [P.VIEW] }); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await screen.findByText('Not assigned');
    expect(screen.queryByRole('button', { name: 'Approve location expenses' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Assign driver' })).toBeNull();
  });
  it('shows uploaded driver expenses and the unassigned total before any location is chosen', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false)); render(<FuelManPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    await screen.findByText('Awaiting locations'); expect(screen.getByRole('button', { name: 'Driver Alp' })).toBeTruthy();
    expect(screen.getByText('1 drivers need a location')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Location totals' }));
    await screen.findByText('2026-07 · Draft location totals');
    const row = screen.getByRole('cell', { name: /Unassigned/ }).closest('tr')!;
    expect(within(row).getByText('$52.50')).toBeTruthy(); expect(fuelApi.command).not.toHaveBeenCalled();
  });
  it('sets up driver locations in one form with a backend command and preserves input on a stale review', async () => {
    vi.mocked(fuelApi.detail).mockResolvedValue(report(false));
    vi.mocked(fuelApi.command).mockRejectedValue(new Error('This review changed. Refresh before saving.'));
    render(<FuelManPage />); fireEvent.click(await screen.findByRole('button', { name: 'July 2026' })); await openDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign locations' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Driver from Users & Roles' }));
    fireEvent.click(screen.getByRole('option', { name: /Driver Alpha/ }));
    expect(screen.queryByText('Create expense profile from report')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use one location for this group' }));
    fireEvent.click(screen.getByRole('option', { name: 'Seattle' })); fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to all 1 drivers' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Assignment note' }), { target: { value: 'Confirmed location' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 1 assignments' })); await screen.findByRole('alert');
    expect(fuelApi.command).toHaveBeenCalledWith(REPORT_ID, 'assignments/batch', expect.objectContaining({ token: report(false).review.token, assignments: [expect.objectContaining({ externalId: 'A', driverKey: 'user:1', allocations: [{ location: 'Seattle', percent: '100' }] })] }));
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
