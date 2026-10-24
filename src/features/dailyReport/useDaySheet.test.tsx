// @vitest-environment jsdom
// useDaySheet's save rules (fake timers, authFetch mocked): the 1.2 s autosave,
// a pending autosave flushed — not cancelled — on day / branch / view change
// and unmount (O12), Submit stopping when its own save fails (O13), a late
// answer for an earlier day ignored (O14), and handSet seeding the touched sets
// so a hand-set figure survives every save (the 2026-08-28 incident).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import type { Report } from './types';

type Call = { url: string; method: string; body: Report & Record<string, unknown> | null; keepalive?: boolean };
const calls: Call[] = [];
let route: (url: string, method: string) => Promise<Response> | undefined = () => undefined;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const dayData = (date: string, notes = `notes ${date}`, extra: Record<string, unknown> = {}) => ({
  handSet: { capacity: ['deliveries'], transferSlabs: ['out:SEA — SLC#18401'] },
  report: {
    date, location: 'Seattle', status: 'draft', notes,
    visitors: { homeowners: 2, fabricators: null, designers: null },
    deliveries: { assigned: 3, capacity: 30 }, pickups: { assigned: 1, capacity: 4 },
    returns: null, returnsSlabs: null, sinks: null, containers: [], payments: {},
    transfers: [
      { fromTo: 'SEA — SLC', transferNumber: '18401', slabs: 24, auto: true, direction: 'out' },
      { fromTo: 'SEA — SPO', transferNumber: '18402', slabs: 10, auto: true, direction: 'out' }
    ],
    ...extra
  },
  derived: { noBranchTickets: 1 }, slabRange: { low: 5, high: 80 }, transfersShippedEarlier: []
});

vi.mock('../../api/authFetch', () => ({
  authFetch: (url: string, opts: { method?: string; body?: string; keepalive?: boolean } = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null, keepalive: opts.keepalive });
    const hit = route(url, method);
    if (hit) return hit;
    if (method !== 'GET') return Promise.resolve(json({ report: {} }));
    const m = url.match(/\/api\/daily-reports\/(\d{4}-\d{2}-\d{2})\?location=([^&]+)/);
    return Promise.resolve(json(m ? dayData(m[1], `notes ${m[1]} ${decodeURIComponent(m[2])}`) : {}));
  }
}));

const { useDaySheet } = await import('./useDaySheet');

type Props = { date: string; location: string; view: string; canEdit?: boolean };
const setup = (initial: Props) => renderHook((p: Props) => {
  const [error, setError] = useState<string | null>(null);
  return { ...useDaySheet({ date: p.date, location: p.location, view: p.view, canEdit: p.canEdit ?? true, setError }), error };
}, { initialProps: initial });

const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const puts = () => calls.filter(c => c.method === 'PUT');
const D1 = '2026-10-20';
const D2 = '2026-10-21';
const start: Props = { date: D1, location: 'Seattle', view: 'day' };

beforeEach(() => { vi.useFakeTimers(); calls.length = 0; route = () => undefined; });
afterEach(() => { vi.useRealTimers(); });

/** An edit, as a cell's onChange makes it. */
const edit = (h: ReturnType<typeof setup>, sinks: string) =>
  act(() => { h.result.current.setReport(r => (r ? { ...r, sinks } : r)); });

describe('useDaySheet', () => {
  it('loads the day and seeds the touched sets from handSet', async () => {
    const h = setup(start);
    await tick();
    expect(h.result.current.loading).toBe(false);
    expect(h.result.current.report?.notes).toBe(`notes ${D1} Seattle`);
    expect(h.result.current.noBranchTickets).toBe(1);
    expect(h.result.current.dirty).toBe(false);
    // Loading isn't an edit: nothing is saved.
    await tick(2000);
    expect(puts()).toHaveLength(0);
  });

  it('autosaves 1.2 s after an edit, as a draft that keeps only hand-set figures', async () => {
    const h = setup(start);
    await tick();
    edit(h, '5');
    expect(h.result.current.dirty).toBe(true);
    await tick(1199);
    expect(puts()).toHaveLength(0);
    await tick(1);
    expect(puts()).toHaveLength(1);
    const body = puts()[0].body as Report;
    expect(body.sinks).toBe('5');
    expect(body.deliveries.capacity).toBe(30);   // handSet: typed on an earlier visit
    expect(body.pickups.capacity).toBeNull();    // never typed: left for the schedule
    expect(body.transfers.map(t => t.transferNumber)).toEqual(['18401']);
    await tick();
    expect(h.result.current.dirty).toBe(false);
    expect(h.result.current.savedAt).toBeInstanceOf(Date);
  });

  it('a figure touched this visit is kept too', async () => {
    const h = setup(start);
    await tick();
    act(() => { h.result.current.touchCapacity('pickups'); h.result.current.touchTransferSlabs('out:SEA — SPO#18402'); });
    edit(h, '1');
    await tick(1200);
    const body = puts()[0].body as Report;
    expect(body.pickups.capacity).toBe(4);
    expect(body.transfers.map(t => t.transferNumber)).toEqual(['18401', '18402']);
  });

  it('flushes a pending autosave when the day changes, and only once (O12)', async () => {
    const h = setup(start);
    await tick();
    edit(h, '7');
    h.rerender({ ...start, date: D2 });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toContain(`/api/daily-reports/${D1}`);
    expect(puts()[0].body?.sinks).toBe('7');
    expect(puts()[0].keepalive).toBe(false);
    await tick(2000);
    expect(puts()).toHaveLength(1);
    expect(h.result.current.report?.date).toBe(D2);
  });

  it('flushes a pending autosave when the branch or the view changes (O12)', async () => {
    const h = setup(start);
    await tick();
    edit(h, '2');
    h.rerender({ ...start, location: 'Spokane' });
    expect(puts()).toHaveLength(1);
    await tick();
    edit(h, '3');
    h.rerender({ ...start, location: 'Spokane', view: 'month' });
    expect(puts()).toHaveLength(2);
    expect(puts()[1].body?.sinks).toBe('3');
  });

  it('flushes a pending autosave on unmount (O12)', async () => {
    const h = setup(start);
    await tick();
    edit(h, '4');
    h.unmount();
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body?.sinks).toBe('4');
  });

  it('flushes with keepalive when the page is hidden', async () => {
    const h = setup(start);
    await tick();
    edit(h, '6');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].keepalive).toBe(true);
    h.unmount();
    expect(puts()).toHaveLength(1);
  });

  it('a failed flush names the day it was for', async () => {
    const h = setup(start);
    await tick();
    route = (url, method) => (method === 'PUT' ? Promise.resolve(json({ message: 'Down' }, 500)) : undefined);
    edit(h, '8');
    h.rerender({ ...start, date: D2 });
    await tick();
    expect(h.result.current.error).toBe(`Your last change to ${D1} wasn't saved (Down). Open that day and check it.`);
  });

  it('Submit does not post /submit when the save before it fails (O13)', async () => {
    const h = setup(start);
    await tick();
    route = (url, method) => (method === 'PUT' ? Promise.resolve(json({ message: 'Server down' }, 500)) : undefined);
    edit(h, '9');
    await act(async () => { await h.result.current.submitDay(); });
    expect(puts()).toHaveLength(1);
    expect(calls.some(c => c.url.includes('/submit'))).toBe(false);
    expect(h.result.current.error).toBe('Couldn’t save your last changes, so the day wasn’t submitted (Server down). Check your connection and try again.');
    // The autosave it replaced never fires.
    await tick(2000);
    expect(puts()).toHaveLength(1);
  });

  it('Submit waits for a save already on the wire, saves, then submits the report’s own day', async () => {
    const h = setup(start);
    await tick();
    let release: () => void = () => {};
    route = (url, method) => (method === 'PUT' && puts().length === 1
      ? new Promise<Response>(res => { release = () => res(json({ report: {} })); })
      : undefined);
    edit(h, '1');
    await tick(1200);                 // the autosave goes out and hangs
    expect(puts()).toHaveLength(1);
    let done = false;
    act(() => { h.result.current.submitDay().then(() => { done = true; }); });
    await tick();
    expect(puts()).toHaveLength(1);   // still waiting for the first
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    await tick();
    expect(puts()).toHaveLength(2);
    const submit = calls.find(c => c.url.includes('/submit'));
    expect(submit?.url).toContain(`/api/daily-reports/${D1}/submit`);
    expect(submit?.body).toEqual({ location: 'Seattle' });
    expect(done).toBe(true);
  });

  it('ignores a late answer for a day no longer selected (O14)', async () => {
    let releaseD1: () => void = () => {};
    route = (url, method) => (method === 'GET' && url.includes(`/${D1}?`)
      ? new Promise<Response>(res => { releaseD1 = () => res(json(dayData(D1, 'late D1'))); })
      : undefined);
    const h = setup(start);
    await tick();
    h.rerender({ ...start, date: D2 });
    await tick();
    expect(h.result.current.report?.date).toBe(D2);
    await act(async () => { releaseD1(); await vi.advanceTimersByTimeAsync(0); });
    expect(h.result.current.report?.date).toBe(D2);
    expect(h.result.current.report?.notes).toBe(`notes ${D2} Seattle`);
    expect(h.result.current.loading).toBe(false);
  });

  it('a save refused as submitted (409) reloads the day', async () => {
    const h = setup(start);
    await tick();
    route = (url, method) => {
      if (method === 'PUT') return Promise.resolve(json({}, 409));
      if (method === 'GET') return Promise.resolve(json(dayData(D1, 'locked', { status: 'submitted' })));
      return undefined;
    };
    edit(h, '2');
    await tick(1200);
    await tick();
    expect(h.result.current.report?.status).toBe('submitted');
    expect(h.result.current.dirty).toBe(false);
  });

  it('saves nothing without edit permission, and loads nothing for All locations', async () => {
    const h = setup({ ...start, canEdit: false });
    await tick();
    edit(h, '3');
    await tick(2000);
    h.unmount();
    expect(puts()).toHaveLength(0);
    calls.length = 0;
    setup({ ...start, location: 'all' });
    await tick();
    expect(calls).toHaveLength(0);
  });
});
