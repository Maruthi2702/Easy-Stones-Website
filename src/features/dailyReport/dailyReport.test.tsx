// @vitest-environment jsdom
// The Daily Report renders (API mocked): a day with every section, a submitted
// day, Reopen, the month, all locations, Export with its Email and PDF
// pop-ups, read-only, and no access.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';

const iso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TODAY = iso(0);
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const payments = { ach: { count: null, amount: null }, cash: { count: 2, amount: 450 }, card: { count: 1, amount: 1200.5 }, check: { count: null, amount: null } };
const day = (status: string) => ({
  handSet: { capacity: [], transferSlabs: [] },
  transfersShippedEarlier: status === 'draft' ? [{ shipDate: iso(-7), count: 1, slabs: 9, reportStatus: 'missing' }] : [],
  report: {
    date: TODAY, location: 'Seattle', status, submittedBy: status === 'submitted' ? 'Rita' : '',
    visitors: { homeowners: 4, fabricators: 2, designers: null },
    deliveries: { assigned: 5, capacity: 40 }, pickups: { assigned: 1, capacity: 6 },
    returns: null, returnsSlabs: null, sinks: 3,
    transfers: [
      { fromTo: 'SEA — SLC', transferNumber: '18401', slabs: 24, auto: true, direction: 'out' },
      { fromTo: 'SPO — SEA', transferNumber: '18377', slabs: 12, auto: true, direction: 'in' }
    ],
    containers: [{ poNumber: 'PO-77', material: 'Calacatta Gold', slabs: 48 }],
    payments, notes: 'Late truck'
  },
  derived: { noBranchTickets: 0 }, slabRange: { low: 10, high: 100 }
});
const row = (date: string, location: string, status: string) => ({ date, location, status, visitors: 6, deliveries: 5, pickups: 1, transferSlabs: 24, transferSlabsIn: 12, transferCount: 1, transferCountIn: 1, containerCount: 1, containerSlabs: 48, payments: 1650.5 });

let status = 'draft';
let branches = ['Seattle', 'Spokane'];
vi.mock('../../api/authFetch', () => ({
  authFetch: (url: string) => {
    if (url.includes('/locations')) return Promise.resolve(json({ locations: branches, allLocations: ['Seattle', 'Spokane', 'Salt Lake City'], canExportAll: true }));
    if (url.includes('/overview/')) return Promise.resolve(json({ rows: [row(TODAY, 'Seattle', 'draft'), row(TODAY, 'Spokane', 'none')], noBranchTickets: 0 }));
    if (url.includes('?month=')) return Promise.resolve(json({ reports: [row(TODAY, 'Seattle', 'submitted')] }));
    if (/\/api\/daily-reports\/\d{4}-\d{2}-\d{2}\?/.test(url)) return Promise.resolve(json(day(status)));
    return Promise.resolve(json({}));
  }
}));

const { default: Tab } = await import('./DailyReportTab');
const DailyReportTab = Tab as unknown as ComponentType<{ currentUser: unknown }>;
const ALL_PERMS = ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'];
const user = (permissions = ALL_PERMS) => ({ _id: 'u1', id: 'u1', location: 'Seattle', assignedLocations: ['Seattle', 'Spokane'], permissions });
const open = async (permissions = ALL_PERMS) => {
  render(<DailyReportTab currentUser={user(permissions)} />);
  await waitFor(() => expect(screen.getByDisplayValue('Late truck')).toBeTruthy());
};

beforeEach(() => { status = 'draft'; branches = ['Seattle', 'Spokane']; try { sessionStorage.clear(); } catch { /* */ } });
afterEach(() => cleanup());

describe('Daily Report', () => {
  it('shows a draft day with every section', async () => {
    await open();
    expect(screen.getByText('Daily Work Report')).toBeTruthy();
    expect(screen.getAllByText('Submit day').length).toBe(2);
    expect(screen.getByText('18401')).toBeTruthy();
    expect((screen.getByLabelText('Container slabs') as HTMLInputElement).value).toBe('48');
    expect((screen.getByLabelText('Cash amount') as HTMLInputElement).value).toBe('450.00');
    expect(screen.getByText(/arrive today but shipped/)).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('a submitted day is locked, with Reopen asking why', async () => {
    status = 'submitted';
    await open();
    expect(screen.getByText('Submitted by Rita')).toBeTruthy();
    expect((screen.getByLabelText('Sinks') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Reopen'));
    expect(screen.getByText('Reopen day')).toBeTruthy();
    expect((screen.getByText('Reopen day') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the month, and all locations', async () => {
    await open();
    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    await waitFor(() => expect(screen.getByText('Month to date')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    await waitFor(() => expect(screen.getByDisplayValue('Late truck')).toBeTruthy());
    fireEvent.click(document.querySelector('.dr-topbar .lf-btn') as Element);
    fireEvent.click(screen.getByText('Clear Filter'));
    await waitFor(() => expect(screen.getByText('All 2 locations')).toBeTruthy());
    expect(screen.getByText('1 of 2 started · 0 submitted')).toBeTruthy();
  });

  it('Export lists its choices and opens Email', async () => {
    await open();
    fireEvent.click(screen.getByText('Export'));
    expect(screen.getByText('Download PDF')).toBeTruthy();
    expect(screen.getByText('Download CSV — every branch')).toBeTruthy();
    fireEvent.click(screen.getByText('Email as PDF…'));
    expect(screen.getByText(`daily_report_${TODAY}_Seattle.pdf`)).toBeTruthy();
  });

  it('read only without edit, and a single branch has no filter', async () => {
    branches = ['Seattle'];
    await open(['view_daily_report']);
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.queryByText('Submit day')).toBeNull();
    expect(document.querySelector('.dr-locpick')?.textContent).toContain('Seattle');
  });

  it('says so without the View permission', () => {
    render(<DailyReportTab currentUser={user([])} />);
    expect(screen.getByText("You don't have access to the Daily Report.")).toBeTruthy();
  });
});
