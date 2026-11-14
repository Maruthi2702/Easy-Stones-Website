/**
 * The Daily Report through the real router, the 11:59 PM job and the data layer's own calls: each
 * request is run on MongoDB, then on Postgres, and must answer the same and leave the same reports
 * behind (Postgres' rows are compared with what the copy makes of MongoDB's — dailyReportRowsOf is
 * the spec). Deliveries, check-ins, payments, Users and Locations stay on MongoDB in both runs
 * (they move in their own switches), so what the sheet derives is the same by construction.
 *
 * The two races the August 2026 incident and the double Seattle email were about are tested
 * for real: two Submits at once sign the day off once; an autosave landing after a submit never
 * turns the day back into a draft.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';

vi.mock('../../services/emailService.ts', async orig => ({
  ...(await orig<Record<string, unknown>>()),
  sendEmail: vi.fn(async () => ({ success: true }))
}));

const { openWriteParity } = await import('../customers/writes/writeParity.ts');
const { normalize } = await import('../customers/parity.ts');
const { default: DailyReport } = await import('../../models/DailyReport.ts');
const { dailyReports, dailyReportTransfers, dailyReportContainers, dailyReportLog } = await import('../schema/operations.ts');
const { dailyReportRowsOf } = await import('../copy/operationsRows.ts');
const { locations } = await import('../schema/reference.ts');
const { referenceIndexOf } = await import('../customers/writes/coreSupport.postgres.ts');
const reports = await import('./index.ts');
const { default: createDailyReportsRouter, addTransferToSubmittedReports } = await import('../../routes/dailyReports.ts');
const { autoSubmitDueDays, fileUnopenedDay } = await import('../../jobs/autoSubmitDailyReports.ts');
const { logEntry } = await import('../../utils/dailyReportLog.ts');
type WriteParity = Awaited<ReturnType<typeof openWriteParity>>;
type Loose = Record<string, any>;

const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ALL = ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report'];
const SEATTLE = { username: 'dee', displayName: 'Dee', permissions: ALL, assignedLocations: ['Seattle'] };
const ADMIN = { username: 'root', displayName: 'Root', permissions: ALL, assignedLocations: ['*'] };
const VIEWER = { username: 'vi', permissions: ['view_daily_report'], assignedLocations: ['Seattle'] };

let t: WriteParity;
let app: express.Express;
const oid = () => new mongoose.Types.ObjectId();
/**
 * Run on MongoDB, then on Postgres. A report a request creates gets an id of its own in each (MongoDB's
 * upsert makes it in the server), so afterwards MongoDB's copy of such a report is re-filed under
 * Postgres' id: rows and ids can then be compared one to one, and the final `differences()` is exact.
 */
const both = async <T,>(run: () => Promise<T>) => {
  const result = await t.both(run);
  const rows = await t.pg.db.select({ id: dailyReports.id, day: dailyReports.day, location: locations.name })
    .from(dailyReports).innerJoin(locations, eq(locations.id, dailyReports.locationId));
  const collection = mongoose.connection.db!.collection('dailyreports');
  for (const doc of await collection.find().toArray()) {
    const row = rows.find(r => r.day === doc.date && r.location === doc.location);
    if (row && row.id !== String(doc._id)) {
      await collection.deleteOne({ _id: doc._id });
      await collection.insertOne({ ...doc, _id: new mongoose.Types.ObjectId(row.id) });
    }
  }
  return result;
};

const at = (iso: string) => new Date(iso);
const auto = (ids: string[], extra: Loose = {}) => ({ fromTo: 'SEA — SPO', transferNumber: '14956', count: 1, slabs: 12, auto: true, direction: 'out', ticketIds: ids, ...extra });

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane', 'Dallas'].map(name => ({ _id: oid(), name })));
    await db.collection('dailyreports').insertMany([
      // An open draft with everything a sheet holds.
      { _id: oid(), date: '2026-11-09', location: 'Seattle', status: 'draft', visitors: { homeowners: 4, fabricators: 1, designers: null },
        deliveries: { assigned: 3, capacity: 40 }, pickups: { assigned: 1, capacity: null }, returns: null, returnsSlabs: null, sinks: 2,
        transfers: [auto(['t1'], { received: false, receivedAt: null, receivedBy: '' }),
          { fromTo: 'SPO — SEA', transferNumber: '777', count: 1, slabs: 8, auto: false, direction: 'in', received: true, receivedAt: at('2026-11-09T20:00:00Z'), receivedBy: 'Dee', ticketIds: [] }],
        containers: [{ poNumber: 'PO-1', material: 'CALACATTA', slabs: 60 }, { poNumber: '', material: 'STATUARIO', slabs: 40 }],
        payments: { ach: { count: null, amount: null }, cash: { count: 2, amount: 300.5 }, card: { count: 1, amount: 99 }, check: { count: null, amount: null }, return: { count: null, amount: null } },
        notes: 'Busy day', submittedBy: '', autoSubmitted: false, reopenedBy: '', reopenReason: '', updatedBy: 'Dee',
        log: [], createdAt: at('2026-11-09T16:00:00Z'), updatedAt: at('2026-11-09T22:00:00Z'), __v: 0 },
      // A submitted day with a log, and a transfer line.
      { _id: oid(), date: '2026-11-08', location: 'Seattle', status: 'submitted', visitors: { homeowners: 2, fabricators: null, designers: null },
        deliveries: { assigned: 0, capacity: 0 }, pickups: { assigned: 0, capacity: 0 }, transfers: [auto(['t0'])], containers: [],
        payments: { cash: { count: 1, amount: 10 } }, submittedBy: 'Scott', submittedAt: at('2026-11-08T23:00:00Z'), autoSubmitted: false,
        log: [{ at: at('2026-11-08T23:00:00Z'), by: 'Scott', action: 'submitted', note: '' }, { at: at('2026-11-08T23:05:00Z'), by: '', action: 'emailed', note: 'To the branch list' }],
        createdAt: at('2026-11-08T16:00:00Z'), updatedAt: at('2026-11-08T23:05:00Z'), __v: 0 },
      { _id: oid(), date: '2026-11-08', location: 'Spokane', status: 'submitted', visitors: { homeowners: 0 }, submittedBy: 'Sam', submittedAt: at('2026-11-09T07:00:00Z'),
        log: [], createdAt: at('2026-11-08T16:00:00Z'), updatedAt: at('2026-11-09T07:00:00Z') },
      // A day from before the log, ACH, directions and the Return method: nothing but the fields.
      { _id: oid(), date: '2026-10-20', location: 'Seattle', status: 'submitted', visitors: { homeowners: 5 }, deliveries: { assigned: 1, capacity: 9 },
        transfers: [{ fromTo: 'SEA — SLC', count: 1, slabs: 5, auto: true }], containers: [{ poNumber: 'OLD', material: 'X', slabs: 90 }],
        payments: { cash: { count: 1, amount: 50 }, card: { count: 0, amount: 0 }, check: { count: 0, amount: 0 } },
        submittedBy: 'Jeremy', submittedAt: at('2026-10-21T01:00:00Z'), reopenedBy: 'Jeremy', reopenedAt: at('2026-10-20T22:00:00Z'), reopenReason: 'fix',
        createdAt: at('2026-10-20T16:00:00Z'), updatedAt: at('2026-10-21T01:00:00Z') },
      // Reopened a while ago and still a draft: the 11:59 PM job's catch-up case.
      { _id: oid(), date: '2026-11-03', location: 'Seattle', status: 'draft', visitors: { homeowners: 1 }, reopenedBy: 'Dee', reopenedAt: at('2026-11-04T18:00:00Z'), reopenReason: 'fix',
        log: [{ at: at('2026-11-04T18:00:00Z'), by: 'Dee', action: 'reopened', note: 'fix' }], createdAt: at('2026-11-03T16:00:00Z'), updatedAt: at('2026-11-04T18:00:00Z') }
    ]);
    // Spokane's unopened Nov 9: a visitor checked in, so the job files it.
    await db.collection('officecheckins').insertOne({ _id: oid(), name: 'Pat', phone: '(509) 555-0100', location: 'Spokane', status: 'New', selections: [], createdAt: at('2026-11-09T20:00:00Z'), updatedAt: at('2026-11-09T20:00:00Z') });
  }, 'DB_DAILY_REPORTS');

  app = express();
  app.use(express.json());
  app.use('/api/daily-reports', createDailyReportsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/** Postgres' reports, lines and log = what the copy makes of MongoDB's now. */
async function expectSameReports() {
  const ref = await referenceIndexOf(t.pg.db);
  const built = (await DailyReport.find().lean()).map(d => dailyReportRowsOf(d as Loose, ref, [])).filter(Boolean)
    .sort((a, b) => a!.report.id.localeCompare(b!.report.id));
  expect(await t.pg.db.select().from(dailyReports).orderBy(asc(dailyReports.id))).toEqual(built.map(b => b!.report));
  const order = <T extends { reportId: string; position: number }>(rows: T[]) => [...rows].sort((a, b) => a.reportId.localeCompare(b.reportId) || a.position - b.position);
  expect(await t.pg.db.select().from(dailyReportTransfers).orderBy(asc(dailyReportTransfers.reportId), asc(dailyReportTransfers.position))).toEqual(order(built.flatMap(b => b!.transfers)));
  expect(await t.pg.db.select().from(dailyReportContainers).orderBy(asc(dailyReportContainers.reportId), asc(dailyReportContainers.position))).toEqual(order(built.flatMap(b => b!.containers)));
  expect(await t.pg.db.select().from(dailyReportLog).orderBy(asc(dailyReportLog.reportId), asc(dailyReportLog.position))).toEqual(order(built.flatMap(b => b!.log)));
}

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test, { binary = false, unordered = false } = {}) {
  const ask = async () => {
    const r = await send(request(app)).set(as(user));
    const body = binary ? undefined : (r.body && Object.keys(r.body).length ? r.body : r.text);
    // MongoDB leaves reports of the same day in no set order (Postgres lists them by branch).
    if (unordered && Array.isArray(body?.reports)) body.reports.sort((x: Loose, y: Loose) => y.date.localeCompare(x.date) || x.location.localeCompare(y.location));
    // A report that isn't saved yet has an id made on the spot; whatever it is, it isn't compared.
    const noIds = (v: any): any => Array.isArray(v) ? v.map(noIds)
      : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_id').map(([k, x]) => [k, noIds(x)])) : v;
    return { status: r.status, type: r.headers['content-type'], body: noIds(body) };
  };
  const { mongo, postgres } = await both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(postgres.type).toBe(mongo.type);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  await expectSameReports();
  return mongo;
}

/** A save body like the sheet's. */
const sheet = (over: Loose = {}) => ({
  location: 'Seattle', visitors: { homeowners: 3, fabricators: 2, designers: null },
  deliveries: { assigned: 2, capacity: 25 }, pickups: { assigned: 0, capacity: null }, returns: null, returnsSlabs: null, sinks: 1,
  transfers: [{ fromTo: 'SEA — SPO', transferNumber: '14956', count: 1, slabs: 12, auto: true, direction: 'out', ticketIds: ['t1'], received: false },
    { fromTo: 'SPO — SEA', transferNumber: '9, 10', slabs: 6, auto: false }],
  containers: [{ poNumber: 'PO-9', material: 'QUARTZ', slabs: 80 }, { poNumber: '', material: '', slabs: 0 }],
  payments: { cash: { count: 1, amount: '20.50' } }, notes: '  night shift ', ...over
});

describe('reading', () => {
  it('a saved draft, an unsaved day, a submitted one and a day from before the log', async () => {
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-09?location=Seattle'));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-12?location=Seattle'));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-08?location=Seattle'));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-10-20?location=Seattle'));
    expect((await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-09?location=Spokane'))).status).toBe(403);
  });

  it('the month, the overview, the export and the submitted days', async () => {
    await same(SEATTLE, a => a.get('/api/daily-reports?month=2026-11&location=Seattle'), { unordered: true });
    await same(ADMIN, a => a.get('/api/daily-reports?month=2026-11&location=all'), { unordered: true });
    await same(ADMIN, a => a.get('/api/daily-reports?month=2026-10&location=Seattle'), { unordered: true });
    await same(ADMIN, a => a.get('/api/daily-reports/overview/2026-11-08'));
    await same(ADMIN, a => a.get('/api/daily-reports/export/2026-11?location=all'));
    await same(ADMIN, a => a.get('/api/daily-reports/export/2026-10?location=Seattle'));
    const days = await same(SEATTLE, a => a.get('/api/daily-reports/submitted-days?days=Seattle|2026-11-08,Seattle|2026-11-09,Spokane|2026-11-08'));
    expect(days.body.days).toHaveLength(2);
  });

  it('the log, with a day from before the log showing its own fields', async () => {
    const log = await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-08/log?location=Seattle'));
    expect(log.body.entries).toHaveLength(2);
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-10-20/log?location=Seattle'));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-09-01/log?location=Seattle'));
  });

  it('the day PDF and the month PDF build (status and type only — the bytes carry a clock)', async () => {
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-09/pdf?location=Seattle'), { binary: true });
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-20/pdf?location=Seattle'), { binary: true });
    await same(ADMIN, a => a.get('/api/daily-reports/export/2026-11/pdf?location=all'), { binary: true });
  });

  it('the Payments page’s submitted-day lock reads the same', async () => {
    for (const [location, date] of [['Seattle', '2026-11-08'], ['Seattle', '2026-11-09'], ['Spokane', '2026-11-08'], ['Seattle', '2026-12-31']]) {
      const { mongo, postgres } = await both(async () => ({ locked: await reports.isDaySubmitted(location, date), status: await reports.reportDayStatus(location, date).then(x => x && { status: x.status, by: x.submittedBy, at: x.submittedAt, auto: Boolean(x.autoSubmitted) }) }));
      expect(normalize(postgres)).toEqual(normalize(mongo));
    }
  });
});

describe('saving a draft', () => {
  it('an existing draft and a new day; what is typed is cleaned the same', async () => {
    await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-09').send(sheet()));
    await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-11').send(sheet({ status: 'closed', notes: '' })));
    await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-11').send(sheet({ transfers: [], containers: [], payments: {} })));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-11?location=Seattle'));
  });

  it('refuses a submitted day, a stranger’s branch and a login that may only view', async () => {
    expect((await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-08').send(sheet()))).status).toBe(409);
    expect((await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-09').send(sheet({ location: 'Spokane' })))).status).toBe(403);
    expect((await same(VIEWER, a => a.put('/api/daily-reports/2026-11-09').send(sheet()))).status).toBe(403);
    expect((await same(SEATTLE, a => a.put('/api/daily-reports/nope').send(sheet()))).status).toBe(400);
  });

  it('an autosave landing after a submit never turns the day back into a draft', async () => {
    const run = () => reports.writeDraft('2026-11-08', 'Seattle', { date: '2026-11-08', location: 'Seattle', status: 'draft', notes: 'late' });
    const { mongo, postgres } = await both(run);
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
    await expectSameReports();
  });
});

describe('submitting and reopening', () => {
  it('submit signs the day off once, logs it, and a second submit is refused', async () => {
    const first = await same(SEATTLE, a => a.post('/api/daily-reports/2026-11-09/submit').send({ location: 'Seattle' }));
    expect(first.body.report.status).toBe('submitted');
    expect(first.body.report.log).toHaveLength(1);
    expect((await same(SEATTLE, a => a.post('/api/daily-reports/2026-11-09/submit').send({ location: 'Seattle' }))).status).toBe(409);
    expect((await same(SEATTLE, a => a.post('/api/daily-reports/2026-12-30/submit').send({ location: 'Seattle' }))).status).toBe(404);
    expect((await same(VIEWER, a => a.post('/api/daily-reports/2026-11-11/submit').send({ location: 'Seattle' }))).status).toBe(403);
  });

  it('two submits at the same moment: exactly one wins, the day carries one submit line', async () => {
    await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-11').send(sheet()));
    const race = async () => {
      const both = await Promise.all([1, 2].map(() => request(app).post('/api/daily-reports/2026-11-11/submit').send({ location: 'Seattle' }).set(as(SEATTLE))));
      return both.map(r => r.status).sort();
    };
    const { mongo, postgres } = await both(race);
    expect(mongo).toEqual([200, 409]);
    expect(postgres).toEqual([200, 409]);
    await expectSameReports();
    const day = await t.on('postgres', () => reports.findReport('2026-11-11', 'Seattle'));
    expect(day!.log.filter(l => l.action === 'submitted')).toHaveLength(1);
  });

  it('reopen needs a reason, adds the older submit to the log first, then its own line', async () => {
    expect((await same(SEATTLE, a => a.post('/api/daily-reports/2026-11-08/reopen').send({ location: 'Seattle', reason: 'x' }))).status).toBe(400);
    const done = await same(SEATTLE, a => a.post('/api/daily-reports/2026-11-08/reopen').send({ location: 'Seattle', reason: 'update payments' }));
    expect(done.body.report.status).toBe('draft');
    await same(SEATTLE, a => a.post('/api/daily-reports/2026-10-20/reopen').send({ location: 'Seattle', reason: 'older day' }));
    expect((await same(SEATTLE, a => a.post('/api/daily-reports/2026-09-02/reopen').send({ location: 'Seattle', reason: 'no such day' }))).status).toBe(404);
    // A reopened day is editable again, and submitting it a second time keeps both submits in the log.
    await same(SEATTLE, a => a.put('/api/daily-reports/2026-11-08').send(sheet({ notes: 'fixed' })));
    await same(SEATTLE, a => a.post('/api/daily-reports/2026-11-08/submit').send({ location: 'Seattle' }));
    await same(SEATTLE, a => a.get('/api/daily-reports/2026-11-08/log?location=Seattle'));
  });
});

describe('the rest of the writes', () => {
  it('a line in the log (an email), and nothing for a day never saved', async () => {
    await both(() => reports.pushReportLog('2026-11-09', 'Seattle', logEntry('emailed', 'Dee', 'To a@b.com')));
    await both(() => reports.pushReportLog('2030-01-01', 'Seattle', logEntry('emailed', 'Dee', 'nobody')));
    await expectSameReports();
  });

  it('a transfer logged on arrival lands on each submitted day once, and a repeat adds nothing', async () => {
    const ticket = { id: 'tk-77', location: 'Seattle', transferDestination: 'Spokane', numberOfSlabs: 14, soNumber: 'SO-77', date: '2026-11-08', expectedArrivalDate: '2026-11-08' };
    const { mongo, postgres } = await both(async () => ({
      first: await addTransferToSubmittedReports(ticket, new Date('2026-11-10T17:30:00Z'), 'Dee'),
      again: await addTransferToSubmittedReports(ticket, new Date('2026-11-10T17:31:00Z'), 'Dee')
    }));
    expect(postgres).toEqual(mongo);
    expect(mongo.first).toHaveLength(2);
    expect(mongo.again).toHaveLength(0);
    await expectSameReports();
  });

  it('the 11:59 PM job signs off the due drafts (a reopened old one too) and files an unopened day with activity', async () => {
    const { mongo, postgres } = await both(() => autoSubmitDueDays());
    expect(postgres).toEqual(mongo);
    expect(mongo.length).toBeGreaterThan(0);
    await expectSameReports();
    // Run again: nothing left to do, and the unopened day is not filed twice.
    const again = await both(() => autoSubmitDueDays());
    expect(again.postgres).toEqual(again.mongo);
    expect(again.mongo).toEqual([]);
    expect(await t.on('postgres', () => fileUnopenedDay('2026-11-09', 'Spokane'))).toBeNull();
  });
});

it('the two databases hold the same data at the end', async () => {
  expect(await t.differences()).toEqual([]);
});
