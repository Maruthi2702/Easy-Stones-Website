import { describe, it, expect } from 'vitest';
import { applyDerived } from './dailyReports.js';

const baseReport = (overrides = {}) => ({
  status: 'draft',
  visitors: { homeowners: 0 },
  deliveries: { assigned: 0, capacity: null },
  pickups: { assigned: 0, capacity: null },
  returns: null,
  returnsSlabs: null,
  transfers: [],
  ...overrides
});

const baseDerived = (overrides = {}) => ({
  visitorCheckIns: 3,
  deliveriesAssigned: 5,
  pickupsAssigned: 1,
  deliveriesSlabs: 27,
  pickupsSlabs: 4,
  returnsCount: 0,
  returnsSlabs: 0,
  transfers: [],
  ...overrides
});

describe('applyDerived', () => {
  it('never touches a submitted report, no matter what the system now shows', () => {
    const report = baseReport({
      status: 'submitted',
      deliveries: { assigned: 5, capacity: 27 },
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 49, auto: true, direction: 'out' }]
    });
    const result = applyDerived(report, baseDerived({ deliveriesSlabs: 999, transfers: [] }));
    expect(result.deliveries.capacity).toBe(27);
    expect(result.transfers).toHaveLength(1);
  });

  it('fills capacity only while it is still null', () => {
    const report = baseReport();
    applyDerived(report, baseDerived());
    expect(report.deliveries.capacity).toBe(27);
    expect(report.pickups.capacity).toBe(4);
  });

  // Regression: a fresh delivery entered later in the day must not get lost
  // because an earlier autosave already put a number in this box.
  it('does not overwrite a capacity figure that is already on the report', () => {
    const report = baseReport({ deliveries: { assigned: 5, capacity: 10 } });
    applyDerived(report, baseDerived({ deliveriesSlabs: 27 }));
    expect(report.deliveries.capacity).toBe(10);
  });

  it('keeps 0 as a real hand-typed answer, not "uncounted"', () => {
    const report = baseReport({ deliveries: { assigned: 5, capacity: 0 } });
    applyDerived(report, baseDerived({ deliveriesSlabs: 27 }));
    expect(report.deliveries.capacity).toBe(0);
  });

  it('gives a brand-new transfer route its freshly derived slabs', () => {
    const report = baseReport();
    applyDerived(report, baseDerived({
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 49, auto: true, direction: 'out' }]
    }));
    expect(report.transfers).toEqual([
      { fromTo: 'SEA — SLC', count: 1, slabs: 49, auto: true, direction: 'out' }
    ]);
  });

  it('keeps a transfer route\'s already-stored slabs instead of the fresh derive', () => {
    const report = baseReport({
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 40, auto: true, direction: 'out' }]
    });
    applyDerived(report, baseDerived({
      transfers: [{ fromTo: 'SEA — SLC', count: 2, slabs: 90, auto: true, direction: 'out' }]
    }));
    // count is always fresh (it's a straight fact from the schedule); slabs
    // holds at what was already recorded until someone retypes it.
    expect(report.transfers[0]).toEqual({ fromTo: 'SEA — SLC', count: 2, slabs: 40, auto: true, direction: 'out' });
  });

  it('always keeps a manually-added transfer line regardless of what derives', () => {
    const report = baseReport({
      transfers: [{ fromTo: 'DAL — HOU', count: 1, slabs: 12, auto: false, direction: 'out' }]
    });
    applyDerived(report, baseDerived({ transfers: [] }));
    expect(report.transfers).toEqual([
      { fromTo: 'DAL — HOU', count: 1, slabs: 12, auto: false, direction: 'out' }
    ]);
  });

  it('treats an incoming and outgoing line on the same route as distinct', () => {
    const report = baseReport({
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 40, auto: true, direction: 'in' }]
    });
    applyDerived(report, baseDerived({
      transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 50, auto: true, direction: 'out' }]
    }));
    expect(report.transfers).toEqual([
      { fromTo: 'SEA — SLC', count: 1, slabs: 50, auto: true, direction: 'out' }
    ]);
  });
});

// Returns arrived with the 'return' delivery type. They follow a stricter
// fill rule than the capacity fields above, because `returns` is an older
// hand-typed box and on this sheet a blank and a 0 are different answers.
describe('applyDerived — returns', () => {
  it('fills both cells from the day’s return tickets', () => {
    const report = baseReport();
    applyDerived(report, baseDerived({ returnsCount: 2, returnsSlabs: 7 }));
    expect(report.returns).toBe(2);
    expect(report.returnsSlabs).toBe(7);
  });

  it('leaves a quiet day blank rather than answering "none" on the branch’s behalf', () => {
    const report = baseReport();
    applyDerived(report, baseDerived({ returnsCount: 0, returnsSlabs: 0 }));
    expect(report.returns).toBeNull();
    expect(report.returnsSlabs).toBeNull();
  });

  it('never overwrites a figure somebody typed', () => {
    const report = baseReport({ returns: 4, returnsSlabs: 9 });
    applyDerived(report, baseDerived({ returnsCount: 2, returnsSlabs: 7 }));
    expect(report.returns).toBe(4);
    expect(report.returnsSlabs).toBe(9);
  });

  it('keeps a typed 0 — "no returns today" is an answer, not a blank', () => {
    const report = baseReport({ returns: 0, returnsSlabs: 0 });
    applyDerived(report, baseDerived({ returnsCount: 2, returnsSlabs: 7 }));
    expect(report.returns).toBe(0);
    expect(report.returnsSlabs).toBe(0);
  });

  it('fills the slab count even when the tickets carry no slab numbers yet', () => {
    const report = baseReport();
    applyDerived(report, baseDerived({ returnsCount: 3, returnsSlabs: 0 }));
    expect(report.returns).toBe(3);
    // Nobody has counted the slabs on those three tickets, so this stays blank
    // rather than asserting they came back empty.
    expect(report.returnsSlabs).toBeNull();
  });

  it('leaves a submitted report’s returns exactly as signed off', () => {
    const report = baseReport({ status: 'submitted', returns: 1, returnsSlabs: 2 });
    applyDerived(report, baseDerived({ returnsCount: 9, returnsSlabs: 9 }));
    expect(report.returns).toBe(1);
    expect(report.returnsSlabs).toBe(2);
  });
});
