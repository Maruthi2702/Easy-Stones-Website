import { describe, it, expect } from 'vitest';
import {
  arrivalBranchesFor, emptyArrival, arrivalErrors, countArrivalChanges, arrivalPayload, arrivalTicket,
  arrivalFlagText, arrivalEmailLines
} from './transferArrival.ts';

const BRANCHES = ['Seattle', 'Spokane', 'Salt Lake City'];
const TODAY = '2026-11-03';
const good = { from: 'Spokane', to: 'Seattle', arrivedOn: TODAY, transferNumber: '18 936', numberOfSlabs: '12', truckId: 'trk_3rd_party', notes: ' came on the flatbed ' };
const check = (v: Partial<typeof good>, receivingBranches = ['Seattle']) =>
  arrivalErrors({ ...good, ...v }, { receivingBranches, branches: BRANCHES, today: TODAY });

describe('where a person can log an arrival', () => {
  it('is their own branches, or every branch for an all-locations login', () => {
    expect(arrivalBranchesFor(['Seattle', 'Nowhere'], BRANCHES)).toEqual(['Seattle']);
    expect(arrivalBranchesFor(['*'], BRANCHES)).toEqual(BRANCHES);
    expect(arrivalBranchesFor(undefined, BRANCHES)).toEqual([]);
  });

  it('starts on their only branch, arrived today', () => {
    expect(emptyArrival({ today: TODAY, receivingBranches: ['Seattle'], truckId: 'trk_3rd_party' }))
      .toMatchObject({ to: 'Seattle', from: '', arrivedOn: TODAY, truckId: 'trk_3rd_party' });
    expect(emptyArrival({ today: TODAY, receivingBranches: BRANCHES }).to).toBe('');
  });
});

describe('arrivalErrors', () => {
  it('accepts a complete arrival, with or without a transfer #', () => {
    expect(check({})).toEqual({});
    expect(check({ transferNumber: '', notes: '' })).toEqual({});
    expect(check({ numberOfSlabs: '0' })).toEqual({});
  });

  it('needs a known sending branch that isn’t the receiving one', () => {
    expect(check({ from: '' }).from).toBeTruthy();
    expect(check({ from: 'Atlantis' }).from).toBeTruthy();
    expect(check({ from: 'Seattle' }).from).toMatch(/arrived at/);
  });

  it('only at the person’s own branches', () => {
    expect(check({ to: 'Spokane', from: 'Seattle' }).to).toMatch(/own branches/);
    expect(check({ to: 'Spokane', from: 'Seattle' }, arrivalBranchesFor(['*'], BRANCHES))).toEqual({});
  });

  it('needs a real day, not after today', () => {
    expect(check({ arrivedOn: '' }).arrivedOn).toBeTruthy();
    expect(check({ arrivedOn: '2026-02-30' }).arrivedOn).toBeTruthy();
    expect(check({ arrivedOn: '2026-11-04' }).arrivedOn).toMatch(/after today/);
    expect(check({ arrivedOn: '2026-10-28' })).toEqual({});
  });

  it('needs a whole slab count and a driver', () => {
    for (const bad of ['', '-1', '2.5', 'ten']) expect(check({ numberOfSlabs: bad }).numberOfSlabs).toBeTruthy();
    expect(arrivalErrors({ ...good, numberOfSlabs: 7 as unknown as string }, { receivingBranches: ['Seattle'], branches: BRANCHES, today: TODAY })).toEqual({});
    expect(check({ truckId: '' }).truckId).toBeTruthy();
  });
});

describe('the save', () => {
  it('counts changed fields for the unsaved-changes check', () => {
    const start = emptyArrival({ today: TODAY, receivingBranches: ['Seattle'] });
    expect(countArrivalChanges(start, start)).toBe(0);
    expect(countArrivalChanges({ ...start, from: 'Spokane', numberOfSlabs: '4' }, start)).toBe(2);
  });

  it('sends one cleaned transfer number and a number of slabs', () => {
    expect(arrivalPayload(good, 'del_1')).toEqual({
      id: 'del_1', from: 'Spokane', to: 'Seattle', arrivedOn: TODAY, transferNumber: '18936',
      numberOfSlabs: 12, truckId: 'trk_3rd_party', notes: 'came on the flatbed'
    });
  });

  it('is the sender’s transfer, shipped and arrived the same day, completed and received', () => {
    const at = new Date('2026-11-03T18:00:00Z');
    const ticket = arrivalTicket(arrivalPayload(good, 'del_1'), { byName: 'Dee', at });
    expect(ticket).toMatchObject({
      id: 'del_1', deliveryType: 'transfer', location: 'Spokane', transferDestination: 'Seattle',
      customerName: 'Transfer: Spokane → Seattle', date: TODAY, expectedArrivalDate: TODAY,
      soNumber: '18936', invoiceNumber: '18936', numberOfSlabs: 12, truckId: 'trk_3rd_party',
      status: 'completed', receivedAt: at, receivedBy: 'Dee',
      arrivalLogged: { byName: 'Dee', byLocation: 'Seattle', at }
    });
  });
});

describe('what people read', () => {
  it('flags only a logged arrival on the card', () => {
    expect(arrivalFlagText({ arrivalLogged: { byLocation: 'Seattle' } })).toBe('Logged by Seattle on arrival');
    expect(arrivalFlagText({ arrivalLogged: null })).toBe('');
    expect(arrivalFlagText(null)).toBe('');
  });

  it('tells the sender what happened and which submitted reports changed', () => {
    const lines = arrivalEmailLines(
      { location: 'Spokane', transferDestination: 'Seattle', date: TODAY, soNumber: '18936', numberOfSlabs: 1, notes: 'flatbed' },
      { byName: 'Dee', driverName: '3rd party freight', reportsChanged: [{ location: 'Spokane', date: TODAY }] }
    );
    expect(lines[0]).toBe('Seattle logged a transfer from Spokane that wasn’t on the Delivery Schedule.');
    expect(lines[1]).toBe(`Arrived ${TODAY} · Transfer # 18936 · 1 slab · brought by 3rd party freight`);
    expect(lines.join('\n')).toMatch(/Their note: flatbed/);
    expect(lines.join('\n')).toMatch(/added to Spokane’s Daily Work Report for 2026-11-03, which had already been submitted/);
    expect(arrivalEmailLines({ location: 'Spokane', transferDestination: 'Seattle', date: TODAY, numberOfSlabs: 3 }, { byName: 'Dee', reportsChanged: [] })[1])
      .toBe(`Arrived ${TODAY} · no transfer # given · 3 slabs`);
  });
});
