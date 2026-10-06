import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyDerived, incomingTransferQuery, summarise, handSetFigures, claimSubmission } from './dailyReports.js';
import DailyReport from '../models/DailyReport.js';
import { buildDraftPayload } from '../components/sales/dailyreport/savePayload.js';

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
// POST /:date/submit runs applyDerived on the stored draft right before it
// locks the day. The draft was saved by buildDraftPayload, so an untouched
// slab figure arrives blank and a typed one arrives as typed; the read-only
// figures arrive as whatever the page loaded, possibly hours ago.
describe('applyDerived — at submit', () => {
  const morningDraft = () => baseReport({
    visitors: { homeowners: 2, fabricators: 1, designers: null },
    deliveries: { assigned: 3, capacity: null },        // untouched → blank
    pickups: { assigned: 0, capacity: 6 },               // typed
    transfers: [
      { fromTo: 'SEA — SLC', count: 1, slabs: 40, auto: true, direction: 'out' },  // slabs typed
      { fromTo: 'DAL — HOU', count: 2, slabs: 9, auto: false, direction: 'out' }   // added by hand
    ]
  });
  const evening = () => baseDerived({
    visitorCheckIns: 9,
    deliveriesAssigned: 6,
    pickupsAssigned: 2,
    deliveriesSlabs: 31,
    transfers: [
      { fromTo: 'SEA — SLC', count: 3, slabs: 120, auto: true, direction: 'out' },
      { fromTo: 'SEA — SPO', count: 1, slabs: 44, auto: true, direction: 'out' }
    ]
  });

  it('signs off the evening check-ins and schedule counts, not the morning page', () => {
    const r = applyDerived(morningDraft(), evening());
    expect(r.visitors.homeowners).toBe(9);
    expect(r.deliveries.assigned).toBe(6);
    expect(r.pickups.assigned).toBe(2);
  });

  it('fills an untouched slab figure fresh and keeps a typed one', () => {
    const r = applyDerived(morningDraft(), evening());
    expect(r.deliveries.capacity).toBe(31);
    expect(r.pickups.capacity).toBe(6);
    expect(r.visitors.fabricators).toBe(1);
  });

  it('takes transfer counts and routes from the tickets, keeping typed slabs and hand-added lines', () => {
    const r = applyDerived(morningDraft(), evening());
    expect(r.transfers).toEqual([
      { fromTo: 'SEA — SLC', count: 3, slabs: 40, auto: true, direction: 'out' },
      { fromTo: 'SEA — SPO', count: 1, slabs: 44, auto: true, direction: 'out' },
      { fromTo: 'DAL — HOU', count: 2, slabs: 9, auto: false, direction: 'out' }
    ]);
  });
});

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

describe('incomingTransferQuery', () => {
  const q = incomingTransferQuery('2026-09-30', 'Spokane');

  it('matches transfers due at this branch on this day', () => {
    expect(q).toMatchObject({ deliveryType: 'transfer', expectedArrivalDate: '2026-09-30', transferDestination: 'Spokane' });
  });

  it('skips cancelled transfers', () => {
    expect(q.status).toEqual({ $ne: 'cancelled' });
  });

  // A transfer with no driver is still in the sender's Pending Deliveries and
  // isn't counted as shipped on their report, so it isn't incoming yet either.
  it('only counts transfers the sending branch has put on a truck', () => {
    expect(q.truckId).toEqual({ $nin: ['', null] });
  });
});

describe('summarise (month view and CSV figures)', () => {
  const report = {
    date: '2026-10-05', location: 'Spokane', status: 'submitted',
    transfers: [
      { fromTo: 'Spokane → Seattle', count: 2, slabs: 10, direction: 'out' },
      { fromTo: 'Spokane → Kent', count: 1, slabs: 4 },
      { fromTo: 'Seattle → Spokane', count: 3, slabs: 14, direction: 'in' }
    ]
  };

  it('keeps transferCount/transferSlabs as what the branch shipped', () => {
    const s = summarise(report);
    expect(s.transferCount).toBe(3);
    expect(s.transferSlabs).toBe(14);
  });

  it('counts incoming transfers separately', () => {
    const s = summarise(report);
    expect(s.transferCountIn).toBe(3);
    expect(s.transferSlabsIn).toBe(14);
    expect(summarise({ date: '2026-10-05', location: 'Kent' })).toMatchObject({ transferCountIn: 0, transferSlabsIn: 0 });
  });
});

describe('handSetFigures — a correction typed earlier survives a reload and Submit', () => {
  const route = 'SEA — SLC';
  // As stored after a visit where someone typed Deliveries slabs 25 and an
  // auto transfer line's slabs 40 (untouched figures are saved blank / dropped).
  const stored = () => baseReport({
    deliveries: { assigned: 5, capacity: 25 },
    pickups: { assigned: 1, capacity: null },
    transfers: [{ fromTo: route, count: 2, slabs: 40, auto: true, direction: 'out' }]
  });
  const derived = baseDerived({ deliveriesSlabs: 27, pickupsSlabs: 4, transfers: [{ fromTo: route, count: 2, slabs: 120, auto: true, direction: 'out' }] });

  it('lists what a person set, read before the schedule fills the blanks', () => {
    expect(handSetFigures(stored())).toEqual({ capacity: ['deliveries'], transferSlabs: [`out:${route}`] });
    expect(handSetFigures(baseReport())).toEqual({ capacity: [], transferSlabs: [] });
  });

  it('a save after reloading keeps them, and the submit refresh only fills the blanks', () => {
    // Reload: GET reports what was typed, then fills the blanks for the screen.
    const report = stored();
    const handSet = handSetFigures(report);
    applyDerived(report, derived);
    expect(report.pickups.capacity).toBe(4);
    // The next save (e.g. the one right before Submit) with the sheet's
    // touched sets seeded from handSet — nothing typed this visit.
    const body = buildDraftPayload(report, new Set(handSet.capacity), new Set(handSet.transferSlabs));
    expect(body.deliveries.capacity).toBe(25);
    expect(body.pickups.capacity).toBe(null);
    expect(body.transfers).toHaveLength(1);
    // /submit re-derives before locking: corrections stay, blanks are filled.
    applyDerived(body, derived);
    expect(body.deliveries.capacity).toBe(25);
    expect(body.pickups.capacity).toBe(4);
    expect(body.transfers[0].slabs).toBe(40);
  });
});

describe('claimSubmission — one sign-off per day', () => {
  afterEach(() => vi.restoreAllMocks());

  // A stand-in for the stored day: findOneAndUpdate only matches while it's a draft.
  const fakeStore = () => {
    const doc = { _id: 'r1', status: 'draft' };
    vi.spyOn(DailyReport, 'findOneAndUpdate').mockImplementation(async (filter, update) => {
      if (filter._id !== doc._id || doc.status !== filter.status) return null;
      Object.assign(doc, update.$set);
      return { ...doc, toObject: () => ({ ...doc }) };
    });
    return doc;
  };
  const submittedBy = (who) => ({
    _id: 'r1',
    toObject: () => ({ _id: 'r1', __v: 3, status: 'submitted', submittedBy: who })
  });

  it('only matches a day still in draft, and never rewrites _id or __v', async () => {
    fakeStore();
    await claimSubmission(submittedBy('Ann'));
    const [filter, update] = DailyReport.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'r1', status: 'draft' });
    expect(update.$set).not.toHaveProperty('_id');
    expect(update.$set).not.toHaveProperty('__v');
  });

  it('when manual Submit and the 11:59 job race, exactly one wins', async () => {
    const doc = fakeStore();
    const [manual, job] = await Promise.all([claimSubmission(submittedBy('Ann')), claimSubmission(submittedBy('Auto-submitted'))]);
    expect([manual, job].filter(Boolean)).toHaveLength(1);
    expect(doc.submittedBy).toBe('Ann');
    expect(job).toBe(null); // the loser sends no email
  });
});
