import { describe, it, expect } from 'vitest';
import { peopleMatch, peoplePrefilter, dashboardRangeDates } from './dashboardMatch.ts';

describe('peopleMatch', () => {
  it('keeps everyone for ALL_PEOPLE', () => {
    expect(peopleMatch('*', 'visits')).toBeNull();
  });

  it("keeps visits logged by the people, and resources by their uploader", () => {
    expect(peopleMatch(new Set(['a', 'b']), 'visits'))
      .toEqual({ $match: { $expr: { $in: [{ $toString: '$visits.createdBy' }, ['a', 'b']] } } });
    expect(peopleMatch(new Set(['a']), 'resources'))
      .toEqual({ $match: { $expr: { $in: [{ $toString: { $ifNull: ['$resources.uploadedBy', '$resources.createdBy'] } }, ['a']] } } });
  });

  it('keeps nothing for nobody', () => {
    expect(peopleMatch(new Set(), 'visits')).toEqual({ $match: { $expr: { $in: [{ $toString: '$visits.createdBy' }, []] } } });
  });
});

describe('peoplePrefilter', () => {
  it('matches customers with an entry by one of the people, in every stored form', () => {
    const both = (id: unknown) => [id, `oid:${id}`];
    expect(peoplePrefilter(new Set(['a']), 'visits', both))
      .toEqual({ $match: { $or: [{ 'visits.createdBy': { $in: ['a', 'oid:a'] } }] } });
    expect(peoplePrefilter(new Set(['a']), 'resources'))
      .toEqual({ $match: { $or: [{ 'resources.uploadedBy': { $in: ['a'] } }, { 'resources.createdBy': { $in: ['a'] } }] } });
    expect(peoplePrefilter('*', 'visits')).toBeNull();
  });
});

describe('dashboardRangeDates', () => {
  const now = new Date('2026-10-31T18:00:00Z');
  it('counts 7 / 30 / 90 days back from now, open at the end', () => {
    expect(dashboardRangeDates('90days', { now })).toEqual({ startDate: new Date('2026-08-02T18:00:00Z'), endDate: null });
    expect(dashboardRangeDates('7days', { now }).startDate).toEqual(new Date('2026-10-24T18:00:00Z'));
  });
  it('takes Today as the target day it is given', () => {
    const a = new Date('2026-10-31T00:00:00Z');
    const b = new Date('2026-10-31T23:59:59.999Z');
    expect(dashboardRangeDates('1day', { now, startOfTargetDay: a, endOfTargetDay: b })).toEqual({ startDate: a, endDate: b });
  });
  it('reads a custom range as whole days, either way round or half open', () => {
    expect(dashboardRangeDates('custom', { from: '2026-10-20', to: '2026-10-01' })).toEqual({
      startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: new Date('2026-10-20T23:59:59.999Z')
    });
    expect(dashboardRangeDates('custom', { from: '2026-10-01' })).toEqual({ startDate: new Date('2026-10-01T00:00:00.000Z'), endDate: null });
    expect(dashboardRangeDates('custom', { from: 'soon', to: '' })).toEqual({ startDate: null, endDate: null });
  });
  it('leaves All and anything unknown open', () => {
    expect(dashboardRangeDates('all', { now })).toEqual({ startDate: null, endDate: null });
    expect(dashboardRangeDates('fortnight', { now })).toEqual({ startDate: null, endDate: null });
  });
});
