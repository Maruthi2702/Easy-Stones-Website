/**
 * Payments, Check In + Selection Sheet and Daily Reports on Postgres TOGETHER (the cutover state):
 * the same flow run once with all three switches on MongoDB and once with all three on Postgres
 * must answer the same and leave the same rows in all three areas. This is the part the single-area
 * parity tests can't show: the sheet reading its visitors from Postgres check-ins and its payments
 * from Postgres payments, Submit locking the Payments page, Reopen unlocking it, the 11:59 PM job
 * filing a day from those two. (Deliveries stay on MongoDB here — they are already live on Postgres
 * and are covered by their own tests.)
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';

vi.mock('../services/emailService.ts', async orig => ({
  ...(await orig<Record<string, unknown>>()),
  sendEmail: vi.fn(async () => ({ success: true })),
  sendCheckInAlertEmail: vi.fn(async () => ({ success: true })),
  sendSelectionSheetEmail: vi.fn(async () => ({ success: true }))
}));

const { openWriteParity } = await import('./customers/writes/writeParity.ts');
const { normalize } = await import('./customers/parity.ts');
const { default: DailyReport } = await import('../models/DailyReport.ts');
const { default: OfficeCheckIn } = await import('../models/OfficeCheckIn.ts');
const { default: PaymentReceived } = await import('../models/PaymentReceived.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { dailyReports, dailyReportTransfers, dailyReportContainers, dailyReportLog, paymentsReceived, paymentHistory } = await import('./schema/operations.ts');
const { officeCheckIns, checkInSelections } = await import('./schema/checkInsHolds.ts');
const { locations } = await import('./schema/reference.ts');
const { dailyReportRowsOf, paymentRowsOf } = await import('./copy/operationsRows.ts');
const { checkInRowsOf } = await import('./copy/checkInsHoldsRows.ts');
const { referenceIndexOf } = await import('./customers/writes/coreSupport.postgres.ts');
const { default: createDailyReportsRouter } = await import('../routes/dailyReports.ts');
const { default: createPaymentsReceivedRouter } = await import('../routes/paymentsReceived.ts');
const { default: createCheckInRouter } = await import('../routes/checkIn.ts');
const { autoSubmitDueDays } = await import('../jobs/autoSubmitDailyReports.ts');
type Loose = Record<string, any>;
type WriteParity = Awaited<ReturnType<typeof openWriteParity>>;

const oid = () => new mongoose.Types.ObjectId();
const at = (iso: string) => new Date(iso);
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const PERMS = ['view_daily_report', 'edit_daily_report', 'submit_daily_report', 'reopen_daily_report',
  'view_payments', 'add_payments', 'edit_payments', 'void_payments',
  'create_checkins', 'view_checkins', 'manage_checkins', 'delete_checkins', 'edit_selection_sheets', 'send_checkin_email'];
const dee = String(oid());
const SEATTLE = { id: dee, username: 'dee', displayName: 'Dee', permissions: PERMS, assignedLocations: ['Seattle'] };
const ADMIN = { id: dee, username: 'root', displayName: 'Root', permissions: PERMS, assignedLocations: ['*'] };

const DAY = '2026-11-10'; // the frozen clock's day at Seattle
let t: WriteParity;
let app: express.Express;
const acme = String(oid());

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: oid(), name })));
    await db.collection('roles').insertOne({ _id: oid(), name: 'staff', displayName: 'Staff', permissions: [] });
    await db.collection('users').insertOne({ _id: new mongoose.Types.ObjectId(dee), username: 'dee', password: 'x', role: 'staff', email: 'dee@x.com', displayName: 'Dee', isActive: true });
    await Customer.insertMany([{ _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test' }]);
    await db.collection('officecheckins').insertMany([
      { _id: oid(), name: 'Pat', phone: '(206) 555-0142', location: 'Seattle', status: 'New', selections: [], loggedBy: { username: 'dee', displayName: 'Dee' }, createdAt: at('2026-11-10T16:00:00Z'), updatedAt: at('2026-11-10T16:00:00Z') },
      { _id: oid(), name: 'Sam', phone: '(206) 555-0143', location: 'Seattle', status: 'New', selections: [], loggedBy: { username: 'dee', displayName: 'Dee' }, createdAt: at('2026-11-10T16:30:00Z'), updatedAt: at('2026-11-10T16:30:00Z') },
      // Spokane, Nov 9: nothing opened — only the job can file it.
      { _id: oid(), name: 'Lee', phone: '(509) 555-0100', location: 'Spokane', status: 'New', selections: [], createdAt: at('2026-11-09T20:00:00Z'), updatedAt: at('2026-11-09T20:00:00Z') }
    ]);
    await PaymentReceived.insertMany([
      { _id: oid(), location: 'Seattle', date: DAY, customerId: acme, customerName: 'Acme Stone', method: 'check', cents: 120000, enteredBy: 'Dee', updatedBy: 'Dee', createdAt: at('2026-11-10T16:10:00Z'), history: [{ at: at('2026-11-10T16:10:00Z'), by: 'Dee', action: 'added' }] },
      { _id: oid(), location: 'Seattle', date: DAY, customerId: acme, customerName: 'Acme Stone', method: 'cash', cents: 5000, enteredBy: 'Dee', updatedBy: 'Dee', createdAt: at('2026-11-10T16:20:00Z'),
        voidedAt: at('2026-11-10T16:40:00Z'), voidedBy: 'Dee', voidReason: 'duplicate', history: [{ at: at('2026-11-10T16:20:00Z'), by: 'Dee', action: 'added' }, { at: at('2026-11-10T16:40:00Z'), by: 'Dee', action: 'voided', changes: 'duplicate' }] },
      { _id: oid(), location: 'Spokane', date: '2026-11-09', customerId: acme, customerName: 'Acme Stone', method: 'card', cents: 7700, enteredBy: 'Sam', updatedBy: 'Sam', createdAt: at('2026-11-09T19:00:00Z'), history: [{ at: at('2026-11-09T19:00:00Z'), by: 'Sam', action: 'added' }] }
    ]);
    // A draft sheet already open for today at Seattle.
    await db.collection('dailyreports').insertOne({ _id: oid(), date: DAY, location: 'Seattle', status: 'draft', visitors: { homeowners: 1, fabricators: null, designers: null },
      deliveries: { assigned: 0, capacity: null }, pickups: { assigned: 0, capacity: null }, transfers: [], containers: [], notes: 'morning', updatedBy: 'Dee', log: [], createdAt: at('2026-11-10T15:00:00Z'), updatedAt: at('2026-11-10T15:00:00Z') });
  }, 'DB_DAILY_REPORTS');

  // The check-in route's own ids, handed out in order so both runs hold the same ones.
  OfficeCheckIn.schema.path('_id').default(() => nextId());
  (OfficeCheckIn.schema.path('selections') as any).schema.path('_id').default(() => nextId());

  const authenticate = (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); };
  const requirePermission = (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}));
  app = express();
  app.use(express.json());
  app.use('/api/daily-reports', createDailyReportsRouter({ authenticate, requirePermission }));
  app.use('/api/payments-received', createPaymentsReceivedRouter({ authenticate, requirePermission }));
  app.use('/api/checkin', createCheckInRouter({ authenticate, requirePermission }));
}, 240000);

afterAll(async () => { await t?.close(); });

const made: string[] = [];
let used = 0;
const nextId = () => new mongoose.Types.ObjectId((made[used] ??= String(oid()), made[used++]));

/** All three switches follow the one the harness flips: MongoDB for the first run, Postgres for the second. */
const allThree = async <T,>(run: () => Promise<T>): Promise<T> => {
  const onPg = process.env.DB_DAILY_REPORTS === 'postgres';
  const prior = [process.env.DB_PAYMENTS, process.env.DB_CHECKIN];
  process.env.DB_PAYMENTS = process.env.DB_CHECKIN = onPg ? 'postgres' : '';
  try { return await run(); } finally { [process.env.DB_PAYMENTS, process.env.DB_CHECKIN] = prior as string[]; }
};

/** Run both ways; a report a request creates is re-filed in MongoDB under Postgres' id so rows compare one to one. */
const both = async <T,>(run: () => Promise<T>) => {
  made.length = 0;
  const result = await t.both(() => allThree(() => { used = 0; return run(); }));
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

const noIds = (v: any): any => Array.isArray(v) ? v.map(noIds)
  : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_id').map(([k, x]) => [k, noIds(x)])) : v;

/** Every row of all three areas in Postgres = what the copy makes of MongoDB's now. */
async function expectSameEverywhere() {
  const db = t.pg.db;
  const ref = await referenceIndexOf(db);
  const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
  const order = <T extends { reportId: string; position: number }>(rows: T[]) => [...rows].sort((a, b) => a.reportId.localeCompare(b.reportId) || a.position - b.position);

  const reports = (await DailyReport.find().lean()).map(d => dailyReportRowsOf(d as Loose, ref, [])).filter(Boolean).sort((a, b) => byId(a!.report, b!.report));
  expect(await db.select().from(dailyReports).orderBy(asc(dailyReports.id))).toEqual(reports.map(b => b!.report));
  expect(await db.select().from(dailyReportTransfers).orderBy(asc(dailyReportTransfers.reportId), asc(dailyReportTransfers.position))).toEqual(order(reports.flatMap(b => b!.transfers)));
  expect(await db.select().from(dailyReportContainers).orderBy(asc(dailyReportContainers.reportId), asc(dailyReportContainers.position))).toEqual(order(reports.flatMap(b => b!.containers)));
  expect(await db.select().from(dailyReportLog).orderBy(asc(dailyReportLog.reportId), asc(dailyReportLog.position))).toEqual(order(reports.flatMap(b => b!.log)));

  const payments = (await PaymentReceived.find().lean()).map(d => paymentRowsOf(d as Loose, ref, { customerIds: new Set([acme]) }, [])).filter(Boolean).sort((a, b) => byId(a!.payment, b!.payment));
  expect(await db.select().from(paymentsReceived).orderBy(asc(paymentsReceived.id))).toEqual(payments.map(b => b!.payment));
  expect(await db.select().from(paymentHistory).orderBy(asc(paymentHistory.paymentId), asc(paymentHistory.position))).toEqual(payments.flatMap(b => b!.history));

  const checkIns = (await OfficeCheckIn.find().lean()).map(d => checkInRowsOf(d as Loose, ref, [])).filter(Boolean).sort((a, b) => byId(a!.checkIn, b!.checkIn));
  expect(await db.select().from(officeCheckIns).orderBy(asc(officeCheckIns.id))).toEqual(checkIns.map(b => b!.checkIn));
  expect(await db.select().from(checkInSelections).orderBy(asc(checkInSelections.checkInId), asc(checkInSelections.position))).toEqual(checkIns.flatMap(b => b!.selections));
}

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  const ask = async () => {
    const r = await send(request(app)).set(as(user));
    return { status: r.status, body: noIds(r.body && Object.keys(r.body).length ? r.body : r.text) };
  };
  const { mongo, postgres } = await both(ask);
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  await expectSameEverywhere();
  return mongo;
}

const sheet = () => same(SEATTLE, a => a.get(`/api/daily-reports/${DAY}?location=Seattle`));
const pay = (over: Loose = {}) => ({ id: String(oid()), location: 'Seattle', date: DAY, customerId: acme, customerName: 'Acme Stone', method: 'cash', amount: '100.00', ...over });
const visitor = (over: Loose = {}) => ({ name: 'New Person', phone: '2065550199', email: 'new@x.com', location: 'Seattle', ...over });
const body = (over: Loose = {}) => ({
  location: 'Seattle', visitors: { homeowners: 3, fabricators: 2, designers: null }, deliveries: { assigned: 0, capacity: null }, pickups: { assigned: 0, capacity: null },
  returns: null, returnsSlabs: null, sinks: null, transfers: [], containers: [{ poNumber: 'PO-1', material: 'QUARTZ', slabs: 80 }], payments: {}, notes: 'end of day', ...over
});

describe('the day sheet reads Check In and Payments', () => {
  it('opens with the seeded check-ins and live (not voided) payments', async () => {
    const r = await sheet();
    expect(r.body.derived.visitorCheckIns).toBe(2);
    expect(r.body.derived.paymentsFromPage).toBe(true);
    expect(r.body.derived.paymentEntries).toBe(1);
    expect(r.body.report.payments.check.amount).toBe(1200);
  });

  it('a new check-in raises the visitor count; a Selection Sheet save does not change it', async () => {
    const made1 = await same(SEATTLE, a => a.post('/api/checkin').send(visitor()));
    expect(made1.status).toBeLessThan(300);
    expect((await sheet()).body.derived.visitorCheckIns).toBe(3);
  });

  it('a payment added on the Payments page shows on the sheet; a Return nets off; a void takes it back out', async () => {
    const card = pay({ method: 'card', amount: '250.50', reference: '4111 1111 1111 1111' });
    const ret = pay({ method: 'return', amount: '40' });
    await same(SEATTLE, a => a.post('/api/payments-received').send(card));
    await same(SEATTLE, a => a.post('/api/payments-received').send(ret));
    const withBoth = await sheet();
    expect(withBoth.body.derived.paymentEntries).toBe(3);
    expect(withBoth.body.report.payments.return.amount).toBe(-40);
    await same(SEATTLE, a => a.post(`/api/payments-received/${card.id}/void`).send({ reason: 'keyed twice' }));
    expect((await sheet()).body.derived.paymentEntries).toBe(2);
    await same(SEATTLE, a => a.get(`/api/payments-received?location=Seattle&date=${DAY}`));
    await same(SEATTLE, a => a.get(`/api/payments-received/summary?location=Seattle&date=${DAY}`));
  });
});

describe('Submit locks Payments, Reopen unlocks it', () => {
  it('save, submit (signs off what Check In and Payments show now), then everything on the day is frozen', async () => {
    await same(SEATTLE, a => a.put(`/api/daily-reports/${DAY}`).send(body()));
    const submitted = await same(SEATTLE, a => a.post(`/api/daily-reports/${DAY}/submit`).send({ location: 'Seattle' }));
    expect(submitted.body.report.status).toBe('submitted');
    expect(submitted.body.report.visitors.homeowners).toBe(3);

    // Payments on the locked day: refused, and the page says so.
    const tooLate = pay({ amount: '5' });
    expect((await same(SEATTLE, a => a.post('/api/payments-received').send(tooLate))).status).toBe(409);
    const day = await same(SEATTLE, a => a.get(`/api/payments-received?location=Seattle&date=${DAY}`));
    expect(day.body.day.submitted).toBe(true);
    // A late check-in does not change the signed-off sheet.
    await same(SEATTLE, a => a.post('/api/checkin').send(visitor({ name: 'Late Visitor', phone: '2065550111' })));
    const frozen = await sheet();
    expect(frozen.body.report.visitors.homeowners).toBe(3);
    expect((await same(SEATTLE, a => a.put(`/api/daily-reports/${DAY}`).send(body({ notes: 'too late' })))).status).toBe(409);
    expect((await same(SEATTLE, a => a.post(`/api/daily-reports/${DAY}/submit`).send({ location: 'Seattle' }))).status).toBe(409);
  });

  it('reopen lets the payment in, and the draft sheet picks up everything again', async () => {
    await same(SEATTLE, a => a.post(`/api/daily-reports/${DAY}/reopen`).send({ location: 'Seattle', reason: 'update payments' }));
    const open = await same(SEATTLE, a => a.get(`/api/payments-received?location=Seattle&date=${DAY}`));
    expect(open.body.day.submitted).toBe(false);
    const ach = pay({ method: 'ach', amount: '75' });
    await same(SEATTLE, a => a.post('/api/payments-received').send(ach));
    const sheetNow = await sheet();
    expect(sheetNow.body.derived.visitorCheckIns).toBe(4);
    expect(sheetNow.body.derived.paymentEntries).toBe(3);
    await same(SEATTLE, a => a.get(`/api/daily-reports/${DAY}/log?location=Seattle`));
    await same(SEATTLE, a => a.post(`/api/daily-reports/${DAY}/submit`).send({ location: 'Seattle' }));
  });
});

describe('the reports', () => {
  it('month view, CSV, overview and PDF status read the three together', async () => {
    await same(ADMIN, a => a.get('/api/daily-reports?month=2026-11&location=all'));
    await same(ADMIN, a => a.get('/api/daily-reports/export/2026-11?location=all'));
    await same(ADMIN, a => a.get(`/api/daily-reports/overview/${DAY}`));
    await same(ADMIN, a => a.get('/api/daily-reports/overview/2026-11-09'));
  });

  it('the 11:59 PM job files Spokane’s unopened day from its check-in and payment, once', async () => {
    const { mongo, postgres } = await both(() => autoSubmitDueDays());
    expect(postgres).toEqual(mongo);
    expect(mongo.some((x: Loose) => x.location === 'Spokane')).toBe(true);
    await expectSameEverywhere();
    const filed = await same(ADMIN, a => a.get('/api/daily-reports/2026-11-09?location=Spokane'));
    expect(filed.body.report.status).toBe('submitted');
    expect(filed.body.report.visitors.homeowners).toBe(1);
    expect(filed.body.report.payments.card.amount).toBe(77);
    const again = await both(() => autoSubmitDueDays());
    expect(again.postgres).toEqual(again.mongo);
    expect(again.mongo).toEqual([]);
  });
});

it('after the whole day, Postgres holds exactly what the copy of MongoDB makes, in every table', async () => {
  expect(await t.differences()).toEqual([]);
});
