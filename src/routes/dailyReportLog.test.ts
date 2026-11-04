import type { Loose } from '../types/records.ts';
// The Daily Report's log (More → View Log) through the real routes and the
// 11:59 PM job, against a throwaway in-memory MongoDB: Seattle on Nov 3 2026 —
// submitted, reopened "update payments", never submitted again, signed off by
// the job — leaves every step and both emails in the log.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../services/emailService.ts', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

const { default: createDailyReportsRouter } = await import('./dailyReports.ts');
const { autoSubmitDueDays } = await import('../jobs/autoSubmitDailyReports.ts');
const { default: DailyReport } = await import('../models/DailyReport.ts');
const { default: Location } = await import('../models/Location.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;

const PERMS = ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'];
const SCOTT = { username: 'scott', displayName: 'Scott', permissions: PERMS, assignedLocations: ['Seattle'] };
const JEREMY = { username: 'jeremy', displayName: 'Jeremy Earnest', permissions: PERMS, assignedLocations: ['Seattle'] };
const DAY = '2026-11-03';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await DailyReport.createIndexes();
  app = express();
  app.use(express.json());
  app.use('/api/daily-reports', createDailyReportsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({}))
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await DailyReport.collection.deleteMany({});
  await Location.collection.deleteMany({});
  await Location.collection.insertOne({ name: 'Seattle', dailyReportEmail: { userIds: [], extraEmails: ['ops@example.com', 'owner@example.com'] } });
});

const as = (user: Loose) => ({
  get: (url: string) => request(app).get(`/api/daily-reports${url}`).set('x-test-user', JSON.stringify(user)),
  post: (url: string, body: Loose) => request(app).post(`/api/daily-reports${url}`).set('x-test-user', JSON.stringify(user)).send(body),
  put: (url: string, body: Loose) => request(app).put(`/api/daily-reports${url}`).set('x-test-user', JSON.stringify(user)).send(body)
});
const logOf = async () => (await as(SCOTT).get(`/${DAY}/log?location=Seattle`).expect(200)).body;
const actions = (body: Loose) => body.entries.map((e: Loose) => [e.action, e.by]);

describe('More → View Log', () => {
  it('a day never saved has nothing', async () => {
    expect(await logOf()).toEqual({ status: 'none', entries: [], earlier: false });
  });

  it('keeps submit, reopen with its reason, the 11:59 PM sign-off and both emails', async () => {
    await as(SCOTT).put(`/${DAY}`, { location: 'Seattle', notes: '' }).expect(200);
    await as(SCOTT).post(`/${DAY}/submit`, { location: 'Seattle' }).expect(200);
    await vi.waitFor(async () => expect((await logOf()).entries).toHaveLength(2));
    await as(JEREMY).post(`/${DAY}/reopen`, { location: 'Seattle', reason: 'update payments' }).expect(200);

    // Nobody submits again; the job signs it off at the next 11:59 PM.
    const done = await autoSubmitDueDays(new Date(Date.now() + 2 * 86400000));
    expect(done).toEqual([{ location: 'Seattle', count: 1 }]);
    await vi.waitFor(async () => expect((await logOf()).entries).toHaveLength(5));

    const body = await logOf();
    expect(body.status).toBe('submitted');
    expect(body.earlier).toBe(false);
    expect(actions(body)).toEqual([
      ['submitted', 'Scott'],
      ['emailed', ''],
      ['reopened', 'Jeremy Earnest'],
      ['auto_submitted', ''],
      ['emailed', '']
    ]);
    expect(body.entries[1].note).toBe("To the branch's Daily Report list (2 people)");
    expect(body.entries[2].note).toBe('update payments');
  });

  it('a day from before the log keeps what its fields held, and a later reopen can\'t overwrite it', async () => {
    // As Seattle's Nov 3 is stored on live today.
    await DailyReport.collection.insertOne({
      date: DAY, location: 'Seattle', status: 'submitted',
      submittedBy: 'Auto-submitted', submittedAt: new Date('2026-11-04T07:59:30Z'), autoSubmitted: true,
      reopenedBy: 'Jeremy Earnest', reopenedAt: new Date('2026-11-04T01:57:36Z'), reopenReason: 'update payments'
    });
    const before = await logOf();
    expect(before.earlier).toBe(true);
    expect(actions(before)).toEqual([['reopened', 'Jeremy Earnest'], ['auto_submitted', '']]);

    await as(SCOTT).post(`/${DAY}/reopen`, { location: 'Seattle', reason: 'add sinks' }).expect(200);
    await as(SCOTT).post(`/${DAY}/submit`, { location: 'Seattle' }).expect(200);
    await vi.waitFor(async () => expect((await logOf()).entries).toHaveLength(5));
    const after = await logOf();
    expect(after.earlier).toBe(true);
    expect(actions(after)).toEqual([
      ['reopened', 'Jeremy Earnest'],
      ['auto_submitted', ''],
      ['reopened', 'Scott'],
      ['submitted', 'Scott'],
      ['emailed', '']
    ]);
  });

  it('the Email button is logged with who sent it and to whom', async () => {
    await as(SCOTT).put(`/${DAY}`, { location: 'Seattle', notes: '' }).expect(200);
    await as(SCOTT).post(`/${DAY}/email`, { location: 'Seattle', to: 'diana@example.com' }).expect(200);
    const body = await logOf();
    expect(body.entries.map((e: Loose) => [e.action, e.by, e.note])).toEqual([['emailed', 'Scott', 'To diana@example.com']]);
  });

  it('only for a branch you have', async () => {
    await as({ ...SCOTT, assignedLocations: ['Spokane'] }).get(`/${DAY}/log?location=Seattle`).expect(403);
    await as({ ...SCOTT, permissions: [] }).get(`/${DAY}/log?location=Seattle`).expect(403);
  });
});
