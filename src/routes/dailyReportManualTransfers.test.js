// Saving the Daily Work Report (PUT /api/daily-reports/:date) against a
// throwaway in-memory MongoDB: a transfer line added by hand is filed by its
// route (manualTransferDirection) — ending at this branch is incoming —
// whatever direction the app sent, so an older cached app that only ever
// sent 'out' gets it right too. Lines from tickets keep their own direction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createDailyReportsRouter } = await import('./dailyReports.js');
const { default: DailyReport } = await import('../models/DailyReport.js');

let mongo;
let app;
const EDITOR = { username: 'dee', permissions: ['view_daily_report', 'edit_daily_report'], assignedLocations: ['Seattle'] };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/daily-reports', createDailyReportsRouter({
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p) => (req, res, next) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({})),
    logActivity: async () => {}
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => { await DailyReport.collection.deleteMany({}); });

const save = (transfers) => request(app).put('/api/daily-reports/2026-10-15')
  .set('x-test-user', JSON.stringify(EDITOR))
  .send({ location: 'Seattle', transfers });

describe('hand-added transfer lines on save', () => {
  it('files a line ending here as incoming and one starting here as outgoing, whatever the app sent', async () => {
    const res = await save([
      { fromTo: 'SPO — SEA', count: 1, slabs: 20, auto: false, direction: 'out' },
      { fromTo: 'SEA — SLC', count: 2, slabs: 30, auto: false, direction: 'in' },
      { fromTo: 'SPO — ', count: 1, slabs: 5, auto: false }
    ]).expect(200);
    expect(res.body.report.transfers.map(t => [t.fromTo, t.direction])).toEqual([
      ['SPO — SEA', 'in'],
      ['SEA — SLC', 'out'],
      ['SPO —', 'out']
    ]);
  });

  it('leaves a ticket line\'s direction as it was', async () => {
    const res = await save([{ fromTo: 'SEA — SPO', count: 1, slabs: 10, auto: true, direction: 'in' }]).expect(200);
    expect(res.body.report.transfers[0].direction).toBe('in');
  });
});
