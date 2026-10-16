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

describe('one transfer per line, each with its number', () => {
  const get = () => request(app).get('/api/daily-reports/2026-10-15?location=Seattle')
    .set('x-test-user', JSON.stringify(EDITOR)).expect(200);
  const transferTicket = (id, soNumber, slabs) => ({
    id, deliveryType: 'transfer', location: 'Seattle', transferDestination: 'Spokane', truckId: 'drv_3rd',
    date: '2026-10-15', status: 'scheduled', soNumber, numberOfSlabs: slabs
  });

  it('stores one number per typed line (spaces and commas dropped) and counts it as one transfer', async () => {
    const res = await save([
      { fromTo: 'DAL — SEA', transferNumber: '14956', slabs: 30, auto: false, count: 99 },
      { fromTo: 'SEA — SLC', transferNumber: ' 149 567 ', slabs: 12, auto: false },
      { fromTo: 'SEA — SLC', transferNumber: '', slabs: 3, auto: false },
      { fromTo: '', transferNumber: '', slabs: null, auto: false }
    ]).expect(200);
    expect(res.body.report.transfers.map(t => [t.fromTo, t.transferNumber, t.count])).toEqual([
      ['DAL — SEA', '14956', 1],
      ['SEA — SLC', '149567', 1],
      ['SEA — SLC', '', 1]
    ]);
  });

  it('keeps a line that has only a transfer number so far', async () => {
    const res = await save([{ fromTo: '', transferNumber: '19010', slabs: null, auto: false }]).expect(200);
    expect(res.body.report.transfers).toHaveLength(1);
  });

  it('gives each ticket its own line with its own number', async () => {
    await Delivery.collection.insertMany([transferTicket('t1', '149567', 5), transferTicket('t2', '14956', 10)]);
    const lines = (await get()).body.report.transfers.filter(t => t.auto && t.direction === 'out');
    expect(lines.map(t => [t.fromTo, t.transferNumber, t.count, t.slabs])).toEqual([
      ['SEA — SPO', '14956', 1, 10],
      ['SEA — SPO', '149567', 1, 5]
    ]);
  });

  it('keeps a slab figure typed on one ticket line on that line only, across a reload', async () => {
    await Delivery.collection.insertMany([transferTicket('t1', '14956', 10), transferTicket('t2', '149567', 5)]);
    const lines = (await get()).body.report.transfers;
    // someone corrects 14956 to 12 and saves
    await save(lines.map(t => (t.transferNumber === '14956' ? { ...t, slabs: 12 } : t))).expect(200);
    const again = await get();
    const byNo = Object.fromEntries(again.body.report.transfers.map(t => [t.transferNumber, t.slabs]));
    expect(byNo).toEqual({ 14956: 12, 149567: 5 });
    expect(again.body.handSet.transferSlabs).toEqual(expect.arrayContaining(['out:SEA — SPO#14956']));
  });

  it('carries a correction from a draft saved per route onto that route\'s one ticket, and keeps it counted as typed', async () => {
    await Delivery.collection.insertOne(transferTicket('t1', '14956', 10));
    // As drafts were stored before: one line per route, its slabs corrected to 40.
    await DailyReport.collection.insertOne({
      date: '2026-10-15', location: 'Seattle', status: 'draft',
      transfers: [{ fromTo: 'SEA — SPO', count: 1, slabs: 40, auto: true, direction: 'out' }]
    });
    const res = await get();
    const line = res.body.report.transfers.find(t => t.auto);
    expect(line).toMatchObject({ transferNumber: '14956', slabs: 40 });
    expect(res.body.handSet.transferSlabs).toEqual(['out:SEA — SPO#14956']);
  });
});
