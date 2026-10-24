// @vitest-environment jsdom
// The Daily Report's save rules, end to end on the rendered sheet (API mocked):
// a pending autosave is sent, not dropped, when the day changes or the sheet
// closes (O12); Submit stops when its own save fails (O13); a late answer for
// a day no longer on screen is ignored (O14); figures someone set by hand on an
// earlier visit (handSet) stay in every save — the 2026-08-28 incident.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';

type Call = { url: string; method: string; body: Record<string, unknown> | null };
const calls: Call[] = [];
type Handler = (url: string, method: string) => Promise<Response> | Response | undefined;
let override: Handler | null = null;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const iso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TODAY = iso(0);
const TOMORROW = iso(1);

const reportFor = (date: string, notes: string) => ({
  handSet: { capacity: ['deliveries'], transferSlabs: [`out:SEA — SLC#18401`] },
  report: {
    date, location: 'Seattle', status: 'draft',
    visitors: { homeowners: 3, fabricators: null, designers: null },
    deliveries: { assigned: 4, capacity: 41 }, pickups: { assigned: 1, capacity: 9 },
    returns: null, returnsSlabs: null, sinks: null,
    transfers: [
      { fromTo: 'SEA — SLC', transferNumber: '18401', slabs: 24, auto: true, direction: 'out' },
      { fromTo: 'SEA — SPO', transferNumber: '18402', slabs: 10, auto: true, direction: 'out' },
      { fromTo: 'SEA — SPO', transferNumber: '18390', slabs: 6, auto: false, direction: 'out' }
    ],
    containers: [], payments: {}, notes
  },
  derived: { noBranchTickets: 0 }, slabRange: null
});

const fake = vi.fn((url: string, opts: { method?: string; body?: string } = {}) => {
  const method = opts.method || 'GET';
  calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
  const hit = override?.(url, method);
  if (hit) return Promise.resolve(hit);
  if (url.includes('/api/daily-reports/locations')) return Promise.resolve(json({ locations: ['Seattle'], allLocations: ['Seattle', 'Spokane', 'Salt Lake City'], canExportAll: false }));
  if (method === 'PUT') return Promise.resolve(json({ report: {} }));
  if (method === 'POST') return Promise.resolve(json({ report: {} }));
  const m = url.match(/\/api\/daily-reports\/(\d{4}-\d{2}-\d{2})\?/);
  if (m) return Promise.resolve(json(reportFor(m[1], `notes for ${m[1]}`)));
  return Promise.resolve(json({}));
});
vi.mock('../../api/authFetch', () => ({ authFetch: (u: string, o?: { method?: string; body?: string }) => fake(u, o) }));

const { default: Tab } = await import('./DailyReportTab');
const DailyReportTab = Tab as unknown as ComponentType<{ currentUser: unknown }>;
const USER = { _id: 'u1', id: 'u1', location: 'Seattle', permissions: ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'] };

const puts = () => calls.filter(c => c.method === 'PUT');
const notes = () => document.querySelector('textarea.dr-notes') as HTMLTextAreaElement;
const open = async () => {
  const r = render(<DailyReportTab currentUser={USER} />);
  await waitFor(() => expect(notes()?.value).toBe(`notes for ${TODAY}`));
  return r;
};
const typeSinks = (v: string) => fireEvent.change(screen.getByLabelText('Sinks'), { target: { value: v } });

beforeEach(() => { calls.length = 0; override = null; fake.mockClear(); });
afterEach(() => cleanup());

describe('Daily Report saves', () => {
  it('a change waiting for the autosave is sent when the day changes (O12)', async () => {
    await open();
    typeSinks('5');
    expect(puts()).toHaveLength(0);
    act(() => { fireEvent.click(screen.getByLabelText('Next day')); });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toContain(`/api/daily-reports/${TODAY}`);
    expect(puts()[0].body?.sinks).toBe('5');
    await waitFor(() => expect(notes()?.value).toBe(`notes for ${TOMORROW}`));
    // Sent once: the timer it replaced doesn't fire it again.
    await act(async () => { await new Promise(r => setTimeout(r, 1400)); });
    expect(puts()).toHaveLength(1);
  });

  it('a change waiting for the autosave is sent when the sheet closes (O12)', async () => {
    const r = await open();
    typeSinks('2');
    r.unmount();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body?.sinks).toBe('2');
  });

  it('autosaves after 1.2 s, keeping hand-set figures and dropping untouched auto ones', async () => {
    await open();
    typeSinks('3');
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    const body = puts()[0].body as { deliveries: { capacity: unknown }; pickups: { capacity: unknown }; transfers: { transferNumber: string }[] };
    expect(body.deliveries.capacity).toBe(41);
    expect(body.pickups.capacity).toBeNull();
    expect(body.transfers.map(t => t.transferNumber)).toEqual(['18401', '18390']);
    await waitFor(() => expect(screen.getByText(/Draft · saved/)).toBeTruthy());
  });

  it('typing a slab figure marks it as set by hand', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Pick-ups slabs'), { target: { value: '7' } });
    fireEvent.change(screen.getAllByLabelText('Transfer slabs')[1], { target: { value: '11' } });
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    const body = puts()[0].body as { pickups: { capacity: unknown }; transfers: { transferNumber: string; slabs: unknown }[] };
    expect(body.pickups.capacity).toBe('7');
    expect(body.transfers.map(t => [t.transferNumber, t.slabs])).toEqual([['18401', 24], ['18402', '11'], ['18390', 6]]);
  });

  it('Submit does not lock the day when its own save fails (O13)', async () => {
    await open();
    override = (url, method) => (method === 'PUT' ? json({ message: 'Server down' }, 500) : undefined);
    typeSinks('9');
    await act(async () => { fireEvent.click(screen.getAllByText('Submit day')[0]); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('so the day wasn’t submitted (Server down)'));
    expect(calls.some(c => c.url.includes('/submit'))).toBe(false);
  });

  it('Submit saves, then posts /submit for the report’s own day', async () => {
    await open();
    typeSinks('1');
    await act(async () => { fireEvent.click(screen.getAllByText('Submit day')[0]); });
    await waitFor(() => expect(calls.some(c => c.url.includes(`/api/daily-reports/${TODAY}/submit`))).toBe(true));
    const i = calls.findIndex(c => c.url.includes('/submit'));
    expect(calls[i - 1].method).toBe('PUT');
    expect(calls[i].body).toEqual({ location: 'Seattle' });
    // Only the one save: the waiting autosave was folded into it.
    expect(puts()).toHaveLength(1);
  });

  it('a late answer for a day no longer on screen is ignored (O14)', async () => {
    await open();
    let releaseLate: () => void = () => {};
    const AFTER = iso(2);
    override = (url, method) => {
      if (method === 'GET' && url.includes(`/api/daily-reports/${TOMORROW}?`)) {
        return new Promise<Response>(res => { releaseLate = () => res(json(reportFor(TOMORROW, 'late answer'))); }) as unknown as Response;
      }
      return undefined;
    };
    act(() => { fireEvent.click(screen.getByLabelText('Next day')); });
    act(() => { fireEvent.click(screen.getByLabelText('Next day')); });
    await waitFor(() => expect(notes()?.value).toBe(`notes for ${AFTER}`));
    await act(async () => { releaseLate(); await new Promise(r => setTimeout(r, 20)); });
    expect(notes().value).toBe(`notes for ${AFTER}`);
  });

  it('a save refused because the day was submitted reloads it locked', async () => {
    await open();
    override = (url, method) => {
      if (method === 'PUT') return json({ message: 'submitted' }, 409);
      if (method === 'GET' && url.includes(`/api/daily-reports/${TODAY}?`)) {
        const r = reportFor(TODAY, 'locked');
        return json({ ...r, report: { ...r.report, status: 'submitted', submittedBy: 'Rita' } });
      }
      return undefined;
    };
    typeSinks('4');
    await waitFor(() => expect(screen.getByText('Submitted by Rita')).toBeTruthy(), { timeout: 2500 });
    // The note saying why stays up after the reload (it used to be cleared by
    // the reload in the same render, leaving a locked sheet with no reason).
    expect(screen.getByRole('alert').textContent).toContain('This day has been submitted');
  });
});
