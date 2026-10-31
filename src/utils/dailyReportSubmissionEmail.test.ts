import type { Loose } from '../types/records.ts';
/**
 * The daily report email goes to each location's list (Users & Roles →
 * Locations), against an in-memory MongoDB with the email sender mocked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../services/emailService.ts', () => ({
  sendEmail: vi.fn(async () => ({ success: true }))
}));

const { sendEmail } = await import('../services/emailService.ts');
const { notifyDailyReportSubmission, seedSeattleRecipients } = await import('./dailyReportSubmissionEmail.ts');
const { default: Location } = await import('../models/Location.ts');
const { default: User } = await import('../models/User.ts');

let mongo;
const report = (location: string): Loose => ({
  date: '2026-10-15', location, status: 'submitted', submittedBy: 'Krish',
  visitors: { homeowners: 1 }, deliveries: {}, pickups: {}, transfers: [], containers: [],
  payments: { ach: { count: 1, amount: 500 } }, notes: ''
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  sendEmail.mockClear();
  await Location.deleteMany({});
  await User.deleteMany({});
});

const user = (username: unknown, email: string, isActive = true) =>
  User.create({ username, displayName: username, password: 'secret123', email, isActive });

describe('daily report email', () => {
  it('goes to the location’s active users and typed addresses, with the PDF', async () => {
    const sree = await user('sree', 'sree@easystones.com');
    const gone = await user('gone', 'gone@easystones.com', false);
    await Location.create({
      name: 'Kent',
      dailyReportEmail: { userIds: [String(sree._id), String(gone._id)], extraEmails: ['owner@example.com'] }
    });
    await notifyDailyReportSubmission(report('Kent'));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(['sree@easystones.com', 'owner@example.com']);
    expect(mail.subject).toBe('Daily Work Report — Kent, 2026-10-15');
    expect(mail.attachments[0].filename).toMatch(/\.pdf$/);
    expect(mail.attachments[0].content.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('follows a user’s new email address', async () => {
    const sree = await user('sree', 'sree@easystones.com');
    await Location.create({ name: 'Kent', dailyReportEmail: { userIds: [String(sree._id)], extraEmails: [] } });
    await User.updateOne({ _id: sree._id }, { email: 'sree.new@easystones.com' });
    await notifyDailyReportSubmission(report('Kent'));
    expect(sendEmail.mock.calls[0][0].to).toEqual(['sree.new@easystones.com']);
  });

  it('sends nothing for a location with nobody listed, or no location record', async () => {
    await Location.create({ name: 'Spokane' });
    await notifyDailyReportSubmission(report('Spokane'));
    await notifyDailyReportSubmission(report('Nowhere'));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('Seattle no longer has a list in the code — only what its location says', async () => {
    await Location.create({ name: 'Seattle' });
    await notifyDailyReportSubmission(report('Seattle'));
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('Seattle’s one-time copy of the old list', () => {
  // A location saved before the list existed has no field at all.
  const oldSeattle = () => Location.collection.insertOne({ name: 'Seattle' });

  it('keeps the same four people getting Seattle’s email', async () => {
    const sree = await user('sree', 'sree@easystones.com');
    await oldSeattle();
    const seeded = await seedSeattleRecipients();
    expect(seeded.userIds).toEqual([String(sree._id)]);
    expect(seeded.extraEmails).toEqual(['jeremy@easystones.com', 'vish@easystones.com', 'krish@easystones.com']);
    await notifyDailyReportSubmission(report('Seattle'));
    expect([...sendEmail.mock.calls[0][0].to].sort()).toEqual([
      'jeremy@easystones.com', 'krish@easystones.com', 'sree@easystones.com', 'vish@easystones.com'
    ]);
  });

  it('runs once: a list emptied later stays empty after a restart', async () => {
    await oldSeattle();
    expect(await seedSeattleRecipients()).not.toBeNull();
    await Location.updateOne({ name: 'Seattle' }, { dailyReportEmail: { userIds: [], extraEmails: [] } });
    expect(await seedSeattleRecipients()).toBeNull();
    const seattle = await Location.findOne({ name: 'Seattle' }).lean();
    expect(seattle.dailyReportEmail).toEqual({ userIds: [], extraEmails: [] });
  });

  it('leaves other locations alone', async () => {
    await Location.collection.insertOne({ name: 'Kent' });
    expect(await seedSeattleRecipients()).toBeNull();
    expect((await Location.collection.findOne({ name: 'Kent' })).dailyReportEmail).toBeUndefined();
  });
});
