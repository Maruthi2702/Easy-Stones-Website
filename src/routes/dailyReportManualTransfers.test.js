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
const { default: Delivery } = await import('../models/Delivery.js');

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

beforeEach(async () => {
  await DailyReport.collection.deleteMany({});
  await Delivery.collection.deleteMany({});
});

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

describe('transfer numbers instead of a typed count', () => {
  it('stores a typed line\'s transfer number and counts the transfers from it', async () => {
    const res = await save([
      { fromTo: 'DAL — SEA', transferNumber: '19002, 19003', slabs: 30, auto: false, count: 99 },
      { fromTo: 'SEA — SLC', transferNumber: '', slabs: 12, auto: false },
      { fromTo: '', transferNumber: '', slabs: null, auto: false }
    ]).expect(200);
    expect(res.body.report.transfers.map(t => [t.fromTo, t.transferNumber, t.count])).toEqual([
      ['DAL — SEA', '19002, 19003', 2],
      ['SEA — SLC', '', 1]
    ]);
  });

  it('keeps a line that has only a transfer number so far', async () => {
    const res = await save([{ fromTo: '', transferNumber: '19010', slabs: null, auto: false }]).expect(200);
    expect(res.body.report.transfers).toHaveLength(1);
    expect(res.body.report.transfers[0].count).toBe(1);
  });

  it('fills a ticket line with its tickets\' transfer numbers', async () => {
    await Delivery.collection.insertMany([
      { id: 't1', deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', truckId: 'drv_3rd', date: '2026-10-15', status: 'scheduled', soNumber: '18936', numberOfSlabs: 10 },
      { id: 't2', deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', truckId: 'drv_3rd', date: '2026-10-15', status: 'scheduled', soNumber: '18940', numberOfSlabs: 5 }
    ]);
    const res = await request(app).get('/api/daily-reports/2026-10-15?location=Seattle')
      .set('x-test-user', JSON.stringify(EDITOR)).expect(200);
    const line = res.body.report.transfers.find(t => t.auto && t.direction === 'out');
    expect(line).toMatchObject({ fromTo: 'SEA — SPO', transferNumber: '18936, 18940', count: 2, slabs: 15 });
  });
});
