import { describe, it, expect } from 'vitest';
import { isDueForAutoSubmit } from './autoSubmitDailyReports.js';

// Seattle is on Pacific time; in October that's UTC-7.
const sea = (local) => new Date(`${local}-07:00`);

describe('isDueForAutoSubmit', () => {
  it('a day nobody reopened: today at 11:59 PM, an earlier day straight away', () => {
    expect(isDueForAutoSubmit({ date: '2026-10-06' }, 'Seattle', sea('2026-10-06T23:58:00'))).toBe(false);
    expect(isDueForAutoSubmit({ date: '2026-10-06' }, 'Seattle', sea('2026-10-06T23:59:00'))).toBe(true);
    expect(isDueForAutoSubmit({ date: '2026-10-05' }, 'Seattle', sea('2026-10-06T09:00:00'))).toBe(true);
  });

  it('a reopened earlier day waits for its next 11:59 PM instead of locking again at once', () => {
    const reopened = { date: '2026-10-04', reopenedAt: sea('2026-10-06T10:15:00') };
    expect(isDueForAutoSubmit(reopened, 'Seattle', sea('2026-10-06T10:16:00'))).toBe(false);
    expect(isDueForAutoSubmit(reopened, 'Seattle', sea('2026-10-06T23:58:00'))).toBe(false);
    expect(isDueForAutoSubmit(reopened, 'Seattle', sea('2026-10-06T23:59:00'))).toBe(true);
    // Missed 11:59 (server asleep): still caught up the next day.
    expect(isDueForAutoSubmit(reopened, 'Seattle', sea('2026-10-07T08:00:00'))).toBe(true);
  });

  it('reopened after 11:59 PM waits for the following night', () => {
    const late = { date: '2026-10-05', reopenedAt: sea('2026-10-06T23:59:30') };
    expect(isDueForAutoSubmit(late, 'Seattle', sea('2026-10-07T00:01:00'))).toBe(false);
    expect(isDueForAutoSubmit(late, 'Seattle', sea('2026-10-07T23:59:00'))).toBe(true);
  });

  it('today, reopened after a 5 PM submit, still signs off at 11:59 PM as before', () => {
    const today = { date: '2026-10-06', reopenedAt: sea('2026-10-06T18:00:00') };
    expect(isDueForAutoSubmit(today, 'Seattle', sea('2026-10-06T20:00:00'))).toBe(false);
    expect(isDueForAutoSubmit(today, 'Seattle', sea('2026-10-06T23:59:00'))).toBe(true);
  });
});
