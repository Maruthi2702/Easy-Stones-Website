import type { Loose } from '../types/records.ts';
import { describe, it, expect } from 'vitest';
import { cleanScheduleFields, localMinutes, isObjectId, DEFAULT_VISIT_MINUTES } from './scheduleRecord';

const id = 'a'.repeat(24);
const make = (over: Loose = {}): Loose => ({ customerId: id, startTime: '2026-10-30T09:00:00.000', ...over });

describe('localMinutes', () => {
  it('reads the stored local shapes', () => {
    expect(localMinutes('2026-10-30T09:00:00.000')).toBe(localMinutes('2026-10-30T09:00'));
    expect(localMinutes('2026-10-30T09:30') - localMinutes('2026-10-30T09:00')).toBe(30);
  });
  it('refuses things that are not a real day or time', () => {
    for (const bad of ['tbd', '', '2026-02-30T09:00', '2026-10-30T25:00', '2026-10-30T09:61', '2026-10-30', '2026-10-30T09:00:00-07:00', null]) {
      expect(localMinutes(bad)).toBeNull();
    }
  });
});

describe('cleanScheduleFields: creating', () => {
  it('defaults the type to Visit and the notes to empty', () => {
    expect(cleanScheduleFields(make()).fields).toEqual({
      customerId: id, startTime: '2026-10-30T09:00:00.000', activityType: 'Visit', notes: ''
    });
  });
  it('needs a customer and a start time', () => {
    expect(cleanScheduleFields({ startTime: '2026-10-30T09:00' }).error).toMatch(/customer/i);
    expect(cleanScheduleFields({ customerId: id }).error).toMatch(/start/i);
  });
  it('refuses a bad customer id, start, end, type and notes', () => {
    expect(cleanScheduleFields(make({ customerId: 'nope' })).error).toMatch(/customer/i);
    expect(cleanScheduleFields(make({ startTime: 'later' })).error).toMatch(/start/i);
    expect(cleanScheduleFields(make({ endTime: 'later' })).error).toMatch(/end/i);
    expect(cleanScheduleFields(make({ activityType: 'Lunch' })).error).toMatch(/type/i);
    expect(cleanScheduleFields(make({ notes: 'x'.repeat(2001) })).error).toMatch(/notes/i);
    expect(cleanScheduleFields(make({ notes: 5 })).error).toMatch(/notes/i);
  });
  it('needs the end after the start', () => {
    expect(cleanScheduleFields(make({ endTime: '2026-10-30T09:00:00.000' })).error).toMatch(/after/i);
    expect(cleanScheduleFields(make({ endTime: '2026-10-30T08:30:00.000' })).error).toMatch(/after/i);
    expect(cleanScheduleFields(make({ endTime: '2026-10-30T09:30:00.000' })).fields.endTime).toBe('2026-10-30T09:30:00.000');
  });
  it('never copies what a write may not set', () => {
    const { fields } = cleanScheduleFields(make({ userId: 'x', source: 'route_planner', linkedVisitId: id, status: 'Completed' }));
    expect(fields).not.toHaveProperty('userId');
    expect(fields).not.toHaveProperty('source');
    expect(fields).not.toHaveProperty('linkedVisitId');
    expect(fields).not.toHaveProperty('status');
  });
});

describe('cleanScheduleFields: updating', () => {
  const existing = { startTime: '2026-10-30T09:00:00.000', endTime: '2026-10-30T09:30:00.000' };
  it('changes only what was sent', () => {
    expect(cleanScheduleFields({ notes: 'call first' }, existing).fields).toEqual({ notes: 'call first' });
  });
  it('checks a start sent alone against the stored end', () => {
    expect(cleanScheduleFields({ startTime: '2026-10-30T10:00:00.000' }, existing).error).toMatch(/after/i);
    expect(cleanScheduleFields({ startTime: '2026-10-30T09:15:00.000' }, existing).fields).toEqual({ startTime: '2026-10-30T09:15:00.000' });
  });
  it('lets a start and end move together', () => {
    expect(cleanScheduleFields({ startTime: '2026-11-02T10:00:00.000', endTime: '2026-11-02T10:30:00.000' }, existing).fields)
      .toEqual({ startTime: '2026-11-02T10:00:00.000', endTime: '2026-11-02T10:30:00.000' });
  });
  it('does not reject an entry for an end it already holds in another shape', () => {
    const imported = { startTime: '2026-10-30T09:00:00.000', endTime: '2026-10-30T10:00:00-07:00' };
    expect(cleanScheduleFields({ notes: 'x' }, imported).fields).toEqual({ notes: 'x' });
  });
  it('accepts a known status only on an update', () => {
    expect(cleanScheduleFields({ status: 'Completed' }, existing).fields).toEqual({ status: 'Completed' });
    expect(cleanScheduleFields({ status: 'Done' }, existing).error).toMatch(/status/i);
  });
});

describe('constants and ids', () => {
  it('assumes 30 minutes', () => expect(DEFAULT_VISIT_MINUTES).toBe(30));
  it('knows an object id', () => {
    expect(isObjectId(id)).toBe(true);
    expect(isObjectId('abc')).toBe(false);
    expect(isObjectId(5)).toBe(false);
  });
});
