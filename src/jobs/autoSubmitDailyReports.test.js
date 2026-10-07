import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isDueForAutoSubmit, hasActivity, fileUnopenedDay } from './autoSubmitDailyReports.js';
import DailyReport from '../models/DailyReport.js';
import Delivery from '../models/Delivery.js';
import OfficeCheckIn from '../models/OfficeCheckIn.js';

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

describe('filing a day nobody opened', () => {
  // Real derive, fake database.
  let tickets = [];
  let checkInCount = 0;
  beforeEach(() => {
    tickets = [];
    checkInCount = 0;
    vi.spyOn(Delivery, 'find').mockImplementation((q) => ({ lean: async () => (q.deliveryType === 'transfer' ? [] : tickets.filter((t) => t.date === q.date)) }));
    vi.spyOn(OfficeCheckIn, 'countDocuments').mockImplementation(async () => checkInCount);
  });
  afterEach(() => vi.restoreAllMocks());

  it('hasActivity: any check-in, delivery, pick-up, return or transfer', () => {
    expect(hasActivity({ visitorCheckIns: 0, deliveriesAssigned: 0, pickupsAssigned: 0, returnsCount: 0, transfers: [] })).toBe(false);
    expect(hasActivity({ visitorCheckIns: 1, transfers: [] })).toBe(true);
    expect(hasActivity({ deliveriesAssigned: 2, transfers: [] })).toBe(true);
    expect(hasActivity({ transfers: [{ fromTo: 'SEA — SPO' }] })).toBe(true);
  });

  it('a day with deliveries is filed as auto-submitted with the system\'s figures', async () => {
    tickets = [{ date: '2026-09-25', location: 'Seattle', deliveryType: 'jobsite', truckId: 'drv_sergio', status: 'scheduled', numberOfSlabs: 12 }];
    const save = vi.spyOn(DailyReport.prototype, 'save').mockImplementation(async function () { return this; });
    const r = await fileUnopenedDay('2026-09-25', 'Seattle', new Date('2026-09-26T07:00:00Z'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ date: '2026-09-25', location: 'Seattle', status: 'submitted', autoSubmitted: true, submittedBy: 'Auto-submitted' });
    expect(r.deliveries.assigned).toBe(1);
    expect(r.deliveries.capacity).toBe(12);
  });

  it('a day with nothing at all stays Not started, and isn\'t re-derived every minute', async () => {
    const save = vi.spyOn(DailyReport.prototype, 'save');
    const t0 = new Date('2026-09-27T07:00:00Z');
    expect(await fileUnopenedDay('2026-09-26', 'Dallas', t0)).toBe(null);
    const derives = OfficeCheckIn.countDocuments.mock.calls.length;
    expect(await fileUnopenedDay('2026-09-26', 'Dallas', new Date(t0.getTime() + 60000))).toBe(null);
    expect(OfficeCheckIn.countDocuments.mock.calls.length).toBe(derives); // skipped within the hour
    expect(save).not.toHaveBeenCalled();
  });

  it('two servers filing the same day: the second insert is refused quietly', async () => {
    checkInCount = 3;
    vi.spyOn(DailyReport.prototype, 'save').mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await fileUnopenedDay('2026-09-24', 'Spokane', new Date('2026-09-25T07:00:00Z'))).toBe(null);
  });
});
