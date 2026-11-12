import { describe, it, expect } from 'vitest';
import { calendarParityContext, calendarOrderIds, knownCalendarClock, knownCalendarDifference } from './calendarParity.ts';
import { diffEntries, normalize } from './parity.ts';
import type { Loose } from '../../types/records.ts';

const owner = '100000000000000000000001', date = '200000000000000000000001', zoned = '200000000000000000000002';
const first = '200000000000000000000003', tieA = '200000000000000000000004', tieB = '200000000000000000000005', last = '200000000000000000000006';
const at = new Date('2026-01-01T12:34:56.090Z');
const raw: Loose[] = [
  { _id: date, userId: owner, startTime: at, endTime: new Date('2026-01-01T13:00:00.000Z') },
  { _id: zoned, userId: owner, startTime: '2026-01-02T13:00:00.123Z', endTime: '2026-01-02T14:00:00.456Z' },
  { _id: first, userId: owner, startTime: '2026-01-03T09:00:00.000' },
  { _id: tieA, userId: owner, startTime: '2026-01-03T10:00:00.000' },
  { _id: tieB, userId: owner, startTime: '2026-01-03T10:00:00.000' },
  { _id: last, userId: owner, startTime: '2026-01-03T11:00:00.000' }
];
const facts = calendarParityContext(raw, [{ _id: owner, location: 'Dallas' }]);
const unknown = (mongo: unknown, postgres: unknown) => diffEntries(normalize(mongo), normalize(postgres))
  .filter(d => !knownCalendarClock(d, { postgres: normalize(postgres), calendar: facts }));
const rows = (...ids: string[]) => ids.map(_id => ({ _id }));

describe('source-proven calendar clock differences', () => {
  it('accepts exact source Date spellings for hydrated documents and lean feeds, with branch milliseconds', () => {
    for (const spelling of [at.toString(), at.toISOString()]) {
      expect(unknown([{ _id: date, startTime: spelling }], [{ _id: date, startTime: '2026-01-01T06:34:56.090' }])).toEqual([]);
    }
    expect(unknown({ _id: zoned, startTime: raw[1].startTime, endTime: raw[1].endTime },
      { _id: zoned, startTime: '2026-01-02T07:00:00.123', endTime: '2026-01-02T08:00:00.456' })).toEqual([]);
  });
  it('rejects wrong clocks, another branch, lost milliseconds, changed source values and unknown records', () => {
    const mongo = { _id: date, startTime: at.toISOString() };
    for (const time of ['2026-01-01T06:34:55.090', '2026-01-01T04:34:56.090', '2026-01-01T06:34:56.09']) {
      expect(unknown(mongo, { _id: date, startTime: time })).toHaveLength(1);
    }
    expect(unknown({ ...mongo, startTime: '2026-01-01T12:34:55.090Z' }, { _id: date, startTime: '2026-01-01T06:34:56.090' })).toHaveLength(1);
    expect(unknown({ ...mongo, _id: first }, { _id: first, startTime: '2026-01-01T06:34:56.090' })).toHaveLength(1);
  });
  it('never allows unrelated fields, nested non-calendar clocks, missing rows or unproven local changes', () => {
    const mongo = { _id: date, notes: at.toISOString(), customerId: { startTime: at.toISOString() } };
    const postgres = { _id: date, notes: '2026-01-01T06:34:56.090', customerId: { startTime: '2026-01-01T06:34:56.090' } };
    expect(unknown(mongo, postgres)).toHaveLength(2);
    expect(unknown({ customerId: { _id: date, startTime: at.toISOString() } },
      { customerId: { _id: date, startTime: '2026-01-01T06:34:56.090' } })).toHaveLength(1);
    expect(unknown([{ _id: date, startTime: at.toISOString() }], [])).not.toHaveLength(0);
    expect(unknown({ _id: first, startTime: raw[2].startTime }, { _id: first, startTime: '2026-01-03T09:01:00.000' })).toHaveLength(1);
    expect(knownCalendarClock({ path: 'startTime', mongo: at.toISOString(), postgres: '2026-01-01T06:34:56.090' }, { postgres: { _id: date } })).toBe(false);
  });
  it('tracks only starts the source copy really normalizes; end-only conversion never excludes a start from order', () => {
    expect([...facts.convertedStartIds]).toEqual([date, zoned]);
    const endOnly = calendarParityContext([{ _id: first, userId: owner, startTime: raw[2].startTime, endTime: at }], [{ _id: owner, location: 'Dallas' }]);
    expect(endOnly.convertedStartIds.size).toBe(0);
    const invalid = calendarParityContext([{ _id: first, startTime: 'broken' }], []);
    expect(invalid.convertedStartIds.size).toBe(0);
    expect(invalid.bySchedule.get(first)!.startTime.expected).toBeNull();
  });
});

describe('independent calendar order comparison', () => {
  it('keeps converted clocks in the exact observed order, rather than excluding them', () => {
    const reference = calendarOrderIds(rows(first, tieA, tieB, last, date, zoned), facts);
    expect(reference).toEqual([first, tieA, tieB, last, date, zoned]);
    expect(calendarOrderIds(rows(date, first, tieA, tieB, zoned, last), facts)).not.toEqual(reference);
    expect(calendarOrderIds(rows(first, tieA, tieB, last, zoned), facts)).not.toEqual(reference);
  });
  it('canonicalizes only adjacent equal-source-start groups; never globally sorts non-ties', () => {
    const reference = calendarOrderIds(rows(first, tieA, tieB, last), facts);
    expect(calendarOrderIds(rows(first, tieB, tieA, last), facts)).toEqual(reference);
    expect(calendarOrderIds(rows(tieA, tieB, first, last), facts)).not.toEqual(reference);
    expect(calendarOrderIds(rows(first, tieA, last, tieB), facts)).not.toEqual(reference);
  });
  it('retains missing, extra and duplicate unconverted records as failures', () => {
    const reference = calendarOrderIds(rows(first, tieA, tieB, last), facts);
    expect(calendarOrderIds(rows(first, tieA, last), facts)).not.toEqual(reference);
    expect(calendarOrderIds(rows(first, tieA, tieB, tieB, last), facts)).not.toEqual(reference);
    expect(calendarOrderIds(rows(first, tieA, tieB, last, 'unknown-id'), facts)).not.toEqual(reference);
  });
});

it('allows only the source-proven missing model source default, with no unrelated field allowances', () => {
  const d = { path: '0.source', mongo: undefined, postgres: 'manual' };
  expect(knownCalendarDifference(d, { postgres: [{ _id: date }], calendar: facts, calendarFeed: true })).toBe(true);
  const explicit = calendarParityContext([{ _id: date, source: 'visit_log' }], []);
  const explicitNull = calendarParityContext([{ _id: date, source: null }], []);
  expect(knownCalendarDifference(d, { postgres: [{ _id: date }], calendar: explicitNull, calendarFeed: true })).toBe(false);
  expect(knownCalendarDifference(d, { postgres: [{ _id: date }], calendar: facts })).toBe(false);
  expect(knownCalendarDifference(d, { postgres: [{ _id: date }], calendar: explicit, calendarFeed: true })).toBe(false);
  expect(knownCalendarDifference({ ...d, path: '0.status' }, { postgres: [{ _id: date }], calendar: facts, calendarFeed: true })).toBe(false);
  expect(knownCalendarDifference({ ...d, postgres: 'route_planner' }, { postgres: [{ _id: date }], calendar: facts, calendarFeed: true })).toBe(false);
  expect(knownCalendarDifference({ ...d, path: '0.customerId.source' },
    { postgres: [{ customerId: { _id: date } }], calendar: facts, calendarFeed: true })).toBe(false);
});

it('never permits changed ICS clocks even when they equal the otherwise-known copy conversion', () => {
  for (const path of ['0.startTime', '0.endTime']) {
    const d = { path, mongo: at.toISOString(), postgres: '2026-01-01T06:34:56.090' };
    expect(knownCalendarDifference(d, { postgres: [{ _id: date }], calendar: facts, calendarFeed: true })).toBe(false);
  }
});
