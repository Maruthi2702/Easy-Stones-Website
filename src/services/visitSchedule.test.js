import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../models/Schedule.js', () => ({
  default: {
    findOneAndUpdate: vi.fn(),
    create: vi.fn(),
    findOneAndDelete: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn()
  }
}));
vi.mock('../models/User.js', () => ({ default: { findById: vi.fn() } }));

const { default: Schedule } = await import('../models/Schedule.js');
const { default: User } = await import('../models/User.js');
const {
  dropInStartTime, addMinutesToLocal, activityTypeForVisit,
  linkVisitToSchedule, unlinkVisitFromSchedule, moveVisitOnSchedule,
  DROP_IN_DEFAULT_TIME
} = await import('./visitSchedule.js');

const REP = '64b000000000000000000001';
const lean = (value) => ({ select: () => ({ lean: async () => value }), lean: async () => value });

beforeEach(() => {
  vi.clearAllMocks();
  Schedule.findOneAndUpdate.mockResolvedValue(null);
  Schedule.create.mockImplementation(async (doc) => ({ _id: 'new1', ...doc }));
  Schedule.findOneAndDelete.mockResolvedValue(null);
  Schedule.find.mockReturnValue(lean([]));
  Schedule.updateMany.mockResolvedValue({});
  User.findById.mockReturnValue(lean({ location: 'Seattle' }));
});

describe('dropInStartTime', () => {
  // 2026-09-30 21:05 UTC = 14:05 in Seattle (PDT), 17:05 in Atlanta (EDT).
  const now = new Date('2026-09-30T21:05:00Z');

  it('uses the time it was logged, on the logger\'s branch clock, when logged the same day', () => {
    expect(dropInStartTime('2026-09-30', 'Seattle', now)).toBe('2026-09-30T14:05:00.000');
    expect(dropInStartTime('2026-09-30', 'Atlanta', now)).toBe('2026-09-30T17:05:00.000');
  });

  it('falls back to the default time for a visit logged on a later day', () => {
    expect(dropInStartTime('2026-09-28', 'Seattle', now)).toBe(`2026-09-28T${DROP_IN_DEFAULT_TIME}:00.000`);
  });
});

describe('addMinutesToLocal', () => {
  it('adds minutes to a naive local time', () => {
    expect(addMinutesToLocal('2026-09-30T14:05:00.000', 30)).toBe('2026-09-30T14:35:00.000');
  });

  it('rolls past midnight into the next day', () => {
    expect(addMinutesToLocal('2026-09-30T23:50:00.000', 30)).toBe('2026-10-01T00:20:00.000');
  });
});

describe('activityTypeForVisit', () => {
  it('files a resource placement as a drop-off and anything else as a visit', () => {
    expect(activityTypeForVisit('Resource Placement: Catalog')).toBe('Drop-off');
    expect(activityTypeForVisit('Sample drop-off')).toBe('Visit');
    expect(activityTypeForVisit(undefined)).toBe('Visit');
  });
});

describe('linkVisitToSchedule', () => {
  const visit = { customerId: 'cust1', visitId: 'v1', visitDate: '2026-09-28', userId: REP, purpose: 'Check-in' };

  it('completes the logger\'s own scheduled entry for that customer and day, and adds nothing', async () => {
    Schedule.findOneAndUpdate.mockResolvedValue({ _id: 's1', userId: REP });
    const emit = vi.fn();
    await linkVisitToSchedule({ ...visit, emit });

    expect(Schedule.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: REP, customerId: 'cust1', status: 'Scheduled', startTime: { $regex: '^2026-09-28' } },
      { $set: { status: 'Completed', linkedVisitId: 'v1' } },
      { new: true }
    );
    expect(Schedule.create).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({ type: 'upsert', userId: REP, id: 's1' });
  });

  it('adds a completed drop-in to the logger\'s calendar when nothing was scheduled', async () => {
    await linkVisitToSchedule(visit);
    expect(Schedule.create).toHaveBeenCalledWith({
      userId: REP,
      customerId: 'cust1',
      startTime: `2026-09-28T${DROP_IN_DEFAULT_TIME}:00.000`,
      endTime: '2026-09-28T12:30:00.000',
      activityType: 'Visit',
      notes: 'Check-in',
      status: 'Completed',
      linkedVisitId: 'v1',
      source: 'visit_log'
    });
  });

  it('keeps a given start time (a visit moving day)', async () => {
    await linkVisitToSchedule({ ...visit, startTime: '2026-09-28T15:20:00.000' });
    expect(Schedule.create.mock.calls[0][0]).toMatchObject({ startTime: '2026-09-28T15:20:00.000', endTime: '2026-09-28T15:50:00.000' });
  });

  it('skips anyone who isn\'t a staff user', async () => {
    await linkVisitToSchedule({ ...visit, userId: null });
    await linkVisitToSchedule({ ...visit, userId: 'not-an-object-id' });
    expect(Schedule.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Schedule.create).not.toHaveBeenCalled();
  });
});

describe('unlinkVisitFromSchedule', () => {
  it('deletes the visit\'s drop-in and returns its start time', async () => {
    Schedule.findOneAndDelete.mockResolvedValue({ _id: 'd1', userId: REP, startTime: '2026-09-28T15:20:00.000' });
    const emit = vi.fn();
    expect(await unlinkVisitFromSchedule({ visitId: 'v1', emit })).toBe('2026-09-28T15:20:00.000');
    expect(Schedule.findOneAndDelete).toHaveBeenCalledWith({ linkedVisitId: 'v1', source: 'visit_log' });
    expect(emit).toHaveBeenCalledWith({ type: 'delete', userId: REP, id: 'd1' });
  });

  it('puts a planned entry it had completed back to Scheduled', async () => {
    Schedule.find.mockReturnValue(lean([{ _id: 's1', userId: REP }]));
    await unlinkVisitFromSchedule({ visitId: 'v1' });
    expect(Schedule.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['s1'] } },
      { $set: { status: 'Scheduled' }, $unset: { linkedVisitId: '' } }
    );
  });
});

describe('moveVisitOnSchedule', () => {
  it('moves a drop-in to the new day at the same time of day', async () => {
    Schedule.findOneAndDelete.mockResolvedValue({ _id: 'd1', userId: REP, startTime: '2026-09-28T15:20:00.000' });
    await moveVisitOnSchedule({ customerId: 'cust1', visitId: 'v1', newDate: '2026-09-29', userId: REP, purpose: 'Check-in' });
    expect(Schedule.create.mock.calls[0][0]).toMatchObject({
      startTime: '2026-09-29T15:20:00.000', linkedVisitId: 'v1', source: 'visit_log'
    });
  });
});
