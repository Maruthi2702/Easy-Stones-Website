import { describe, it, expect } from 'vitest';
import { todayStops, dueLabel, topFollowUps } from './dashboardFocus.js';

const now = new Date(2026, 9, 18, 12, 0, 0);
const at = (day, h) => new Date(2026, 9, day, h, 0, 0).toISOString();

describe('todayStops', () => {
  it("keeps only today's, in time order, and drops cancelled ones", () => {
    const stops = todayStops([
      { _id: 'b', startTime: at(18, 14), activityType: 'Call', notes: 'Quote' },
      { _id: 'a', startTime: at(18, 9), activityType: 'Visit' },
      { _id: 'x', startTime: at(19, 9), activityType: 'Visit' },
      { _id: 'c', startTime: at(18, 10), activityType: 'Visit', status: 'Cancelled' }
    ], () => 'Acme', now);
    expect(stops.map((s) => s.id)).toEqual(['a', 'b']);
    expect(stops[0].time).toBe('9:00 AM');
    expect(stops[1]).toMatchObject({ type: 'Call', detail: 'Quote', company: 'Acme' });
  });
  it('files an unknown type under Other', () => {
    expect(todayStops([{ startTime: at(18, 9), activityType: 'Lunch' }], () => 'A', now)[0].type).toBe('Other');
  });
});

describe('dueLabel', () => {
  it('names late, today, tomorrow and later days', () => {
    expect(dueLabel(at(16, 9), now)).toEqual({ text: '2 days late', tone: 'late' });
    expect(dueLabel(at(17, 9), now).text).toBe('1 day late');
    expect(dueLabel(at(18, 23), now)).toEqual({ text: 'Today', tone: 'today' });
    expect(dueLabel(at(19, 9), now).text).toBe('Tomorrow');
    expect(dueLabel(at(22, 9), now)).toEqual({ text: 'Oct 22', tone: 'later' });
  });
  it('copes with a missing date', () => {
    expect(dueLabel(undefined, now).text).toBe('');
  });
});

describe('topFollowUps', () => {
  it('sorts earliest first, limits, and skips undated ones', () => {
    const rows = topFollowUps([
      { _id: '1', followUpDate: at(22, 9), followUp: 'later' },
      { _id: '2', followUpDate: at(16, 9), nextAction: 'late one' },
      { _id: '3' },
      { _id: '4', followUpDate: at(19, 9) }
    ], 2, now);
    expect(rows.map((r) => r.id)).toEqual(['2', '4']);
    expect(rows[0]).toMatchObject({ note: 'late one', tone: 'late' });
  });
});
