import { describe, it, expect } from 'vitest';
import { buildDraftPayload, buildSaveBody } from './savePayload';

const baseReport = () => ({
  date: '2026-08-28',
  location: 'Seattle',
  status: 'draft',
  deliveries: { assigned: 5, capacity: 27 },
  pickups: { assigned: 0, capacity: 0 },
  transfers: [
    { fromTo: 'SEA — SLC', count: 1, slabs: 49, auto: true, direction: 'out' },
    { fromTo: 'SEA — SPO', count: 1, slabs: 45, auto: true, direction: 'out' },
    { fromTo: 'DAL — HOU', count: 1, slabs: 12, auto: false, direction: 'out' }
  ]
});

describe('buildDraftPayload', () => {
  it('nulls capacity figures nobody has typed into', () => {
    const body = buildDraftPayload(baseReport(), new Set(), new Set());
    expect(body.deliveries.capacity).toBeNull();
    expect(body.pickups.capacity).toBeNull();
  });

  it('keeps capacity the user actually edited this session', () => {
    const body = buildDraftPayload(baseReport(), new Set(['deliveries']), new Set());
    expect(body.deliveries.capacity).toBe(27);
    expect(body.pickups.capacity).toBeNull();
  });

  it('drops auto transfer lines nobody has typed slabs into', () => {
    const body = buildDraftPayload(baseReport(), new Set(), new Set());
    expect(body.transfers.map(t => t.fromTo)).toEqual(['DAL — HOU']);
  });

  it('keeps an auto transfer line once its slabs figure is hand-edited', () => {
    const body = buildDraftPayload(baseReport(), new Set(), new Set(['out:SEA — SLC']));
    expect(body.transfers.map(t => t.fromTo)).toEqual(['SEA — SLC', 'DAL — HOU']);
  });

  it('always keeps manually-added (non-auto) transfer lines', () => {
    const body = buildDraftPayload(baseReport(), new Set(), new Set());
    expect(body.transfers.some(t => t.fromTo === 'DAL — HOU')).toBe(true);
  });

  it('does not mutate the report handed in', () => {
    const report = baseReport();
    buildDraftPayload(report, new Set(), new Set());
    expect(report.deliveries.capacity).toBe(27);
    expect(report.transfers).toHaveLength(3);
  });
});

describe('buildSaveBody', () => {
  // Regression for the 2026-08-28 incident: submitting a day reused the
  // draft-autosave path, which stripped every untouched auto figure right
  // before /submit permanently froze whatever had just been saved — wiping
  // Deliveries/Pick-ups slabs and transfer lines off of submitted reports
  // that nobody had ever hand-corrected.
  //
  // The save before Submit is now a draft save like any other: POST /submit
  // re-derives before locking (see 'applyDerived — at submit' in
  // src/routes/dailyReports.test.js), so the blanks this leaves are filled
  // with the figures as of the submit rather than locked in empty.
  it('sends the draft body, leaving untouched figures for the server to fill', () => {
    const body = buildSaveBody(baseReport(), {
      touchedCapacity: new Set(),
      touchedTransferSlabs: new Set()
    });
    expect(body.deliveries.capacity).toBeNull();
    expect(body.transfers).toHaveLength(1);
  });

  it('carries what was typed this session through to the submit', () => {
    const body = buildSaveBody(baseReport(), {
      touchedCapacity: new Set(['deliveries']),
      touchedTransferSlabs: new Set(['out:SEA — SLC'])
    });
    expect(body.deliveries.capacity).toBe(27);
    expect(body.transfers.map(t => t.fromTo)).toEqual(['SEA — SLC', 'DAL — HOU']);
  });
});
