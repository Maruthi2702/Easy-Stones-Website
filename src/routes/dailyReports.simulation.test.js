/**
 * Daily Report across every branch — a simulation of a few days of tickets,
 * check-ins and drafts run through the real derive / summarise / auto-submit
 * code, with the database replaced by an in-memory set of documents.
 *
 * Only Seattle files reports today, so live data can't show the other twelve
 * branches' clocks, transfers between branches, or the All-locations view
 * working; this does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Delivery from '../models/Delivery.js';
import OfficeCheckIn from '../models/OfficeCheckIn.js';
import { BRANCH_NAMES, branchDayWindow, branchNow, branchZone } from '../config/branches.js';
import { deriveFromSystem, deliveriesOnDate, applyDerived, summarise, withDraftsDerived } from './dailyReports.js';
import { isDueForAutoSubmit } from '../jobs/autoSubmitDailyReports.js';

// ── a tiny in-memory stand-in for the two collections ──────────────────────
const matches = (doc, query) => Object.entries(query).every(([key, cond]) => {
  if (key === '$or') return cond.some((q) => matches(doc, q));
  const value = doc[key];
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('$ne' in cond && value === cond.$ne) return false;
    if ('$nin' in cond && cond.$nin.includes(value ?? null)) return false;
    if ('$gte' in cond && !(value >= cond.$gte)) return false;
    if ('$lt' in cond && !(value < cond.$lt)) return false;
    return true;
  }
  return value === cond;
});

let tickets = [];
let checkIns = [];
let deliveryQueries = 0;

beforeEach(() => {
  deliveryQueries = 0;
  vi.spyOn(Delivery, 'find').mockImplementation((query) => {
    deliveryQueries += 1;
    return { lean: async () => tickets.filter((t) => matches(t, query)) };
  });
  vi.spyOn(OfficeCheckIn, 'countDocuments').mockImplementation(async (query) => checkIns.filter((c) => matches(c, query)).length);
});
afterEach(() => vi.restoreAllMocks());

const ticket = (over) => ({ deliveryType: 'jobsite', status: 'scheduled', truckId: 'trk_1', numberOfSlabs: 0, location: 'Seattle', ...over });
// A check-in at a branch's local wall-clock time on a date.
const checkInAt = (location, date, hhmm) => {
  const { start } = branchDayWindow(location, date);
  const [h, m] = hhmm.split(':').map(Number);
  return { location, createdAt: new Date(start.getTime() + (h * 60 + m) * 60000) };
};

describe('every branch: its own clock', () => {
  it('each of the 13 branches has a 24-hour day in summer and winter, on its own zone', () => {
    for (const b of BRANCH_NAMES) {
      for (const d of ['2026-07-15', '2026-12-15']) {
        const w = branchDayWindow(b, d);
        expect((w.end - w.start) / 3600000).toBe(24);
        // Local midnight in the branch's zone really is 00:00 there.
        const local = new Intl.DateTimeFormat('en-US', { timeZone: branchZone(b), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(w.start);
        expect(local).toBe('00:00');
      }
    }
  });

  it('every branch has a 23-hour and a 25-hour day at the 2026 daylight-saving changes', () => {
    for (const b of BRANCH_NAMES) {
      const spring = branchDayWindow(b, '2026-03-08');
      const fall = branchDayWindow(b, '2026-11-01');
      expect([(spring.end - spring.start) / 3600000, (fall.end - fall.start) / 3600000]).toEqual([23, 25]);
    }
  });

  it('a check-in late in the evening counts on that branch\'s day, not the next (any zone)', async () => {
    tickets = [];
    checkIns = BRANCH_NAMES.flatMap((b) => [checkInAt(b, '2026-10-05', '23:45'), checkInAt(b, '2026-10-06', '00:10')]);
    for (const b of BRANCH_NAMES) {
      expect((await deriveFromSystem('2026-10-05', b)).visitorCheckIns).toBe(1);
      expect((await deriveFromSystem('2026-10-06', b)).visitorCheckIns).toBe(1);
    }
  });

  it('the 11:59 PM job closes each branch\'s day at 11:59 on its own clock', () => {
    for (const b of BRANCH_NAMES) {
      const { start } = branchDayWindow(b, '2026-10-05');
      const at = (mins) => new Date(start.getTime() + mins * 60000);
      expect(isDueForAutoSubmit({ date: '2026-10-05' }, b, at(23 * 60 + 58))).toBe(false);
      expect(isDueForAutoSubmit({ date: '2026-10-05' }, b, at(23 * 60 + 59))).toBe(true);
      expect(branchNow(b, at(23 * 60 + 59))).toEqual({ date: '2026-10-05', minutes: 23 * 60 + 59 });
    }
    // Eastern branches close three hours before Seattle.
    const eastClose = branchDayWindow('Atlanta', '2026-10-05').start.getTime() + (23 * 60 + 59) * 60000;
    expect(isDueForAutoSubmit({ date: '2026-10-05' }, 'Seattle', new Date(eastClose))).toBe(false);
  });
});

describe('every branch: what the day counts', () => {
  beforeEach(() => {
    checkIns = [];
    tickets = [
      // Seattle's own day
      ticket({ id: 's1', date: '2026-10-05', numberOfSlabs: 12 }),
      ticket({ id: 's2', date: '2026-10-05', numberOfSlabs: 8 }),
      ticket({ id: 's3', date: '2026-10-05', deliveryType: 'will_call', truckId: '', numberOfSlabs: 3 }),
      ticket({ id: 's4', date: '2026-10-05', deliveryType: 'return', truckId: '', customerDropOff: true, numberOfSlabs: 2 }),
      ticket({ id: 's5', date: '2026-10-05', status: 'cancelled', numberOfSlabs: 50 }), // never counted
      ticket({ id: 's6', date: '2026-10-05', truckId: '' }), // Pending — no driver, not counted
      // Dallas's own day
      ticket({ id: 'd1', date: '2026-10-05', location: 'Dallas', numberOfSlabs: 5 }),
      // Transfers: Seattle → Spokane ships the 5th, arrives the 7th; Atlanta → Charlotte same day
      ticket({ id: 't1', date: '2026-10-05', location: 'Seattle', deliveryType: 'transfer', transferDestination: 'Spokane', expectedArrivalDate: '2026-10-07', truckId: 'trk_3rd_party', numberOfSlabs: 14 }),
      ticket({ id: 't2', date: '2026-10-05', location: 'Atlanta', deliveryType: 'transfer', transferDestination: 'Charlotte', expectedArrivalDate: '2026-10-05', numberOfSlabs: 6 }),
      // A transfer still in Pending (no truck) — shipped by nobody yet
      ticket({ id: 't3', date: '2026-10-05', location: 'Dallas', deliveryType: 'transfer', transferDestination: 'Houston', expectedArrivalDate: '2026-10-05', truckId: '' })
    ];
  });

  it('Seattle: deliveries, pick-ups, returns and an outgoing transfer — not cancelled or Pending tickets', async () => {
    const d = await deriveFromSystem('2026-10-05', 'Seattle');
    expect(d).toMatchObject({ deliveriesAssigned: 2, deliveriesSlabs: 20, pickupsAssigned: 1, pickupsSlabs: 3, returnsCount: 1, returnsSlabs: 2 });
    expect(d.transfers).toEqual([expect.objectContaining({ fromTo: 'SEA — SPO', count: 1, slabs: 14, direction: 'out' })]);
  });

  it('a transfer counts once out (origin, ship date) and once in (destination, arrival date)', async () => {
    const lines = async (date, b) => (await deriveFromSystem(date, b)).transfers.map((t) => `${t.direction} ${t.fromTo} ${t.count}`);
    expect(await lines('2026-10-05', 'Spokane')).toEqual([]);
    expect(await lines('2026-10-07', 'Spokane')).toEqual(['in SEA — SPO 1']);
    expect(await lines('2026-10-07', 'Seattle')).toEqual([]);
    expect(await lines('2026-10-05', 'Atlanta')).toEqual(['out ATL — CLT 1']);
    expect(await lines('2026-10-05', 'Charlotte')).toEqual(['in ATL — CLT 1']);
    // Dallas → Houston has no truck yet: neither side counts it.
    expect(await lines('2026-10-05', 'Dallas')).toEqual([]);
    expect(await lines('2026-10-05', 'Houston')).toEqual([]);
  });

  it('one branch\'s tickets never appear on another\'s report', async () => {
    for (const b of BRANCH_NAMES.filter((x) => !['Seattle', 'Dallas'].includes(x))) {
      const d = await deriveFromSystem('2026-10-05', b);
      expect(d.deliveriesAssigned).toBe(0);
    }
    expect((await deriveFromSystem('2026-10-05', 'Dallas')).deliveriesAssigned).toBe(1);
  });

  it('a ticket with no branch (or \'*\') counts on no report, and every branch is told about it', async () => {
    tickets.push(
      ticket({ id: 'x1', date: '2026-10-05', location: '', numberOfSlabs: 40 }),
      ticket({ id: 'x2', date: '2026-10-05', location: '*', deliveryType: 'transfer', transferDestination: 'Spokane', expectedArrivalDate: '2026-10-06', numberOfSlabs: 9 })
    );
    for (const b of BRANCH_NAMES) {
      const d = await deriveFromSystem('2026-10-05', b);
      expect(d.noBranchTickets).toBe(2);
      // Seattle and Dallas keep only their own; no one gains the two.
      expect(d.deliveriesAssigned).toBe({ Seattle: 2, Dallas: 1 }[b] || 0);
      expect(d.transfers.some((t) => t.fromTo.startsWith('* ') || t.slabs === 9)).toBe(false);
    }
  });

  it('All locations: one shared delivery query, and the branch totals add up', async () => {
    const shared = deliveriesOnDate('2026-10-05');
    const before = deliveryQueries;
    const rows = await Promise.all(BRANCH_NAMES.map(async (location) => {
      const report = { date: '2026-10-05', location, status: 'draft', visitors: {}, deliveries: { assigned: 0, capacity: null }, pickups: { assigned: 0, capacity: null }, transfers: [] };
      applyDerived(report, await deriveFromSystem('2026-10-05', location, { deliveryRows: shared }));
      return summarise(report);
    }));
    // Only the per-branch incoming-transfer lookups ran — never the all-branch query again.
    expect(deliveryQueries - before).toBe(BRANCH_NAMES.length);
    const total = (k) => rows.reduce((s, r) => s + r[k], 0);
    expect(total('deliveries')).toBe(3); // Seattle 2 + Dallas 1
    expect(total('pickups')).toBe(1);
    expect(total('transferCount')).toBe(2); // out: SEA→SPO, ATL→CLT
    expect(total('transferCountIn')).toBe(1); // in today: ATL→CLT (SEA→SPO arrives the 7th)
  });

  it('exports: drafts read with the current figures; a signed-off day stays as signed', async () => {
    const draft = (location) => ({ date: '2026-10-05', location, status: 'draft', visitors: { homeowners: 0 }, deliveries: { assigned: 0, capacity: null }, pickups: { assigned: 0, capacity: null }, transfers: [] });
    const signed = { ...draft('Dallas'), status: 'submitted', deliveries: { assigned: 9, capacity: 99 } };
    const [seattle, atlanta, dallas] = (await withDraftsDerived([draft('Seattle'), draft('Atlanta'), signed])).map(summarise);
    expect(seattle).toMatchObject({ deliveries: 2, transferCount: 1, transferSlabs: 14 });
    expect(atlanta).toMatchObject({ transferCount: 1, transferCountIn: 0 });
    expect(dallas).toMatchObject({ deliveries: 9 });
  });
});
