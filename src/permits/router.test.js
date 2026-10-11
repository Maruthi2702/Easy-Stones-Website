// Permits end to end against a real (throwaway, in-memory) MongoDB: the
// morning pull with fake sources (first six-month pull, daily re-reads, a
// failing source, details that don't load, the county report check, when it's
// due), and the API (permissions, filters, counts, customer matches, export).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createPermitsRouter from './router.js';
import { createPermitSync } from './sync.js';
import { Permit, PermitRun, PermitCheck } from './models.js';
import { ALL_PERMIT_PERMISSIONS, PERMITS } from './permissions.js';
import Customer from '../models/Customer.js';

let rs;
let app;
let clock;
let whatcomRows;
let whatcomDetails;
let bellinghamRows;
let report;
let sync;

const quiet = { log() {}, warn() {}, error() {} };
const ADMIN = { id: 'u1', displayName: 'Krish', permissions: [...ALL_PERMIT_PERMISSIONS] };
const VIEWER = { id: 'u2', displayName: 'Maria', permissions: [PERMITS.VIEW] };
const NOBODY = { id: 'u3', displayName: 'Sam', permissions: [] };
const api = (method, url, user = ADMIN) => request(app)[method](`/api/permits${url}`).set('x-test-user', JSON.stringify(user));

const wRow = (n, day, type = 'Building (Residential) - SFR - New Construction', status = 'Issued') => ({
  CaseId: `case-${n}`, CaseNumber: n, CaseType: type, CaseWorkclass: '', CaseStatus: status, IssueDate: `${day}T00:00:00`,
  Address: { AddressLine1: '1', AddressLine2: 'MAIN', StreetTypeName: 'ST', City: 'Ferndale', PostalCode: '98248' }, MainParcel: '', Description: ''
});
const wDetail = (n, gc = 'KVF Construction', phone = '3607397535') => ({
  PermitNumber: n, Description: `Work for ${n}`, ValuationValue: 300000, SquareFeet: 2400,
  Contacts: [{ ContactTypeName: 'Contractor - GC', GlobalEntityName: gc, FirstName: 'Vlad', LastName: 'K', EmailTo: 'kvf@example.com', Phone: phone }]
});
const bRow = (id, no, day, type = 'NEW CONSTRUCTION SINGLE FAMILY OR DUPLEX', sub = 'NEW STRUCTURE') => ({
  OBJECTID: id, PERMIT_NO: no, PermitType: type, PermitSubType: sub, STATUS: 'ISSUED', ISSUED: Date.parse(`${day}T00:00:00Z`),
  SITE_ADDR: '10 OAK ST', DESCRIPTION: 'NEW SFR', JOBVALUE: 450000, CONTRACTOR_NAME: 'Raven Ridge Builders', OWNER_NAME: 'A OWNER', APPLICANT_NAME: 'A OWNER'
});

const fakeWhatcom = {
  issuedSince: async (since) => {
    if (whatcomRows instanceof Error) throw whatcomRows;
    const rows = whatcomRows.filter((r) => r.IssueDate.slice(0, 10) >= since);
    return { rows, pages: 1, total: whatcomRows.length };
  },
  details: async (id) => {
    const n = id.replace('case-', '');
    const d = whatcomDetails[n];
    if (!d) throw new Error('no answer');
    return d;
  }
};
const fakeBellingham = {
  issuedSince: async (since) => {
    if (bellinghamRows instanceof Error) throw bellinghamRows;
    const rows = bellinghamRows.filter((r) => new Date(r.ISSUED).toISOString().slice(0, 10) >= since);
    return { rows, pages: 1, total: rows.length };
  }
};
const fakeReports = {
  list: async () => [{ month: report.month, title: `Permits Issued ${report.month}`, url: 'https://example.com/report.pdf' }],
  permitNumbers: async () => report.numbers
};

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([Permit.init(), PermitRun.init(), PermitCheck.init(), Customer.init()]);
  sync = createPermitSync({ whatcom: fakeWhatcom, bellingham: fakeBellingham, reports: fakeReports, log: quiet, now: () => clock });
  app = express();
  app.use(express.json());
  app.use('/api/permits', createPermitsRouter({
    sync,
    customerIndexMs: 0,
    authenticate: (req, res, next) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'Not signed in.' });
      req.user = JSON.parse(raw);
      return next();
    }
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});

beforeEach(async () => {
  await Promise.all([Permit.deleteMany({}), PermitRun.deleteMany({}), PermitCheck.deleteMany({}), Customer.deleteMany({})]);
  clock = new Date('2026-10-11T12:30:00Z'); // 5:30 AM Pacific
  whatcomRows = [
    wRow('SFR2026-00212', '2026-10-06'),
    wRow('SFR2026-00100', '2026-08-04'),
    wRow('MECR2026-00801', '2026-10-09', 'Mechanical (Residential) - Replacement'),
    wRow('SFR2026-00001', '2026-03-01') // older than six months
  ];
  whatcomDetails = { 'SFR2026-00212': wDetail('SFR2026-00212'), 'SFR2026-00100': wDetail('SFR2026-00100', 'Arrow Homes LLC', '3603193731') };
  bellinghamRows = [
    bRow(1, 'BLD2026-0001', '2026-10-01'),
    bRow(2, 'BLD2026-0002', '2026-09-20', 'EXISTING SINGLE FAMILY OR DUPLEX', 'REPAIR'),
    bRow(3, 'BLD2026-0003', '2026-09-25', 'BUILDING NONRESIDENTIAL', 'CHANGE OF USE')
  ];
  report = { month: '2026-08', numbers: ['SFR2026-00100', 'EFR2026-00001'] };
});

describe('the morning pull', () => {
  it('reads six months back the first time and keeps only lead types', async () => {
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ kind: 'backfill', since: '2026-04-11', ok: true, seen: 3, leads: 2, added: 2, latestIssuedOn: '2026-10-09' });
    expect(out.bellingham).toMatchObject({ kind: 'backfill', ok: true, seen: 3, leads: 1, added: 1 });
    expect(out.bellingham.unsortedTypes).toEqual([{ type: 'BUILDING NONRESIDENTIAL · CHANGE OF USE', count: 1 }]);
    const numbers = (await Permit.find().sort({ permitNumber: 1 }).lean()).map((p) => p.permitNumber);
    expect(numbers).toEqual(['BLD2026-0001', 'SFR2026-00100', 'SFR2026-00212']);
    const p = await Permit.findOne({ permitNumber: 'SFR2026-00212' }).lean();
    expect(p).toMatchObject({ category: 'new_home', issuedOn: '2026-10-06', valuation: 300000, sqft: 2400, city: 'Ferndale' });
    expect(p.contacts[0]).toMatchObject({ kind: 'contractor', company: 'KVF Construction', phone: '3607397535' });
    expect(p.detailsAt).toBeTruthy();
  });

  it('then re-reads the last 30 days each morning, updating rather than duplicating', async () => {
    await sync.run();
    clock = new Date('2026-10-12T12:05:00Z');
    whatcomRows[0] = wRow('SFR2026-00212', '2026-10-06', undefined, 'Final');
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ kind: 'daily', since: '2026-09-12', ok: true, added: 0, updated: 1 });
    expect(await Permit.countDocuments({ permitNumber: 'SFR2026-00212' })).toBe(1);
    expect((await Permit.findOne({ permitNumber: 'SFR2026-00212' }).lean()).status).toBe('Final');
  });

  it('counts a permit as changed only when the source changed it', async () => {
    await sync.run();
    const before = await Permit.findOne({ permitNumber: 'SFR2026-00212' }).lean();
    clock = new Date('2026-10-12T12:05:00Z');
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ ok: true, added: 0, updated: 0 });
    expect(out.bellingham).toMatchObject({ ok: true, added: 0, updated: 0 });
    const after = await Permit.findOne({ permitNumber: 'SFR2026-00212' }).lean();
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
    expect(after.detailsAt.getTime()).toBeGreaterThan(before.detailsAt.getTime());
    expect(after.firstSeenAt).toEqual(before.firstSeenAt);
  });

  it('keeps the saved contacts when a permit’s details don’t load this time', async () => {
    whatcomRows.push(wRow('SFR2026-00300', '2026-10-02'));
    whatcomDetails['SFR2026-00300'] = wDetail('SFR2026-00300');
    await sync.run();
    clock = new Date('2026-10-12T12:05:00Z');
    delete whatcomDetails['SFR2026-00212'];
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ ok: true, detailErrors: 1 });
    const p = await Permit.findOne({ permitNumber: 'SFR2026-00212' }).lean();
    expect(p.contacts[0].company).toBe('KVF Construction');
    expect(p.valuation).toBe(300000);
  });

  it('records a failed source and leaves what was saved alone', async () => {
    await sync.run();
    clock = new Date('2026-10-12T12:05:00Z');
    bellinghamRows = new Error('Bellingham answered 500: error');
    const out = await sync.run();
    expect(out.bellingham).toMatchObject({ ok: false, error: 'Bellingham answered 500: error', kind: 'daily' });
    expect(out.whatcom.ok).toBe(true);
    expect(await Permit.countDocuments({ source: 'bellingham' })).toBe(1);
  });

  it('treats an empty county answer as a failure, not a quiet month', async () => {
    whatcomRows = [];
    const out = await sync.run();
    expect(out.whatcom.ok).toBe(false);
    expect(out.whatcom.error).toMatch(/returned no permits/);
  });

  it('fails the county pull when no permit’s details would open', async () => {
    whatcomDetails = {};
    const out = await sync.run();
    expect(out.whatcom.ok).toBe(false);
    expect(await Permit.countDocuments({ source: 'whatcom' })).toBe(0);
  });

  it('runs again after a failed first pull, as a six-month pull', async () => {
    whatcomRows = new Error('down');
    await sync.run();
    clock = new Date(clock.getTime() + 31 * 60 * 1000);
    whatcomRows = [wRow('SFR2026-00212', '2026-10-06')];
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ kind: 'backfill', ok: true, since: '2026-04-11' });
  });

  it('is due straight away the first time, then once each morning from 5:00 AM Pacific', async () => {
    expect(await sync.isDue()).toBe(true);
    await sync.run();
    expect(await sync.isDue()).toBe(false);
    clock = new Date('2026-10-12T11:55:00Z'); // 4:55 AM
    expect(await sync.isDue()).toBe(false);
    clock = new Date('2026-10-12T12:00:00Z'); // 5:00 AM
    expect(await sync.isDue()).toBe(true);
  });

  it('closes a pull the last server didn’t finish', async () => {
    await PermitRun.create({ source: 'whatcom', kind: 'backfill', since: '2026-04-11', startedAt: new Date(clock.getTime() - 5 * 60000) });
    expect(await sync.closeInterrupted()).toBe(1);
    const run = await PermitRun.findOne({ source: 'whatcom' }).lean();
    expect(run).toMatchObject({ ok: false, error: expect.stringMatching(/restarted/) });
    expect(run.finishedAt).toBeTruthy();
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ kind: 'backfill', ok: true });
  });

  it('saves permits whose details loaded even when some didn’t, and counts the rest', async () => {
    whatcomRows.push(wRow('SFR2026-00300', '2026-10-02'));
    const out = await sync.run();
    expect(out.whatcom).toMatchObject({ ok: true, leads: 3, added: 3, detailErrors: 1 });
    expect((await Permit.findOne({ permitNumber: 'SFR2026-00300' }).lean()).detailsAt).toBeNull();
  });

  it('waits 30 minutes before trying a failed source again', async () => {
    await sync.run();
    clock = new Date('2026-10-12T12:00:00Z');
    bellinghamRows = new Error('down');
    await sync.run();
    clock = new Date('2026-10-12T12:20:00Z');
    expect(await sync.isDue()).toBe(false);
    clock = new Date('2026-10-12T12:31:00Z');
    expect(await sync.isDue()).toBe(true);
  });
});

describe('the county report check', () => {
  it('matches a month permit by permit, ignoring report permits that aren’t leads', async () => {
    whatcomRows.push(wRow('EFR2026-00001', '2026-08-10', 'Building (Commercial) - Eligible Facility Request'));
    await sync.run();
    const check = await PermitCheck.findOne({ month: '2026-08' }).lean();
    expect(check).toMatchObject({ ok: true, inReport: 2, matched: 1, missingFromApp: [], notInReport: [], notInCountySearch: [] });
  });

  it('lists permits the report has that the app doesn’t, and the other way round', async () => {
    whatcomRows.push(wRow('SFR2026-00150', '2026-08-20'));
    whatcomDetails['SFR2026-00150'] = wDetail('SFR2026-00150');
    report.numbers = ['SFR2026-00100', 'SFR2026-00999'];
    await sync.run();
    const check = await PermitCheck.findOne({ month: '2026-08' }).lean();
    expect(check).toMatchObject({ ok: false, missingFromApp: ['SFR2026-00999'], notInReport: ['SFR2026-00150'], notInCountySearch: ['SFR2026-00999'] });
  });

  it('doesn’t download the county’s archive once every month is checked', async () => {
    let listed = 0;
    const counting = createPermitSync({
      whatcom: fakeWhatcom, bellingham: fakeBellingham, log: quiet, now: () => clock,
      reports: { ...fakeReports, list: async () => { listed += 1; return fakeReports.list(); } }
    });
    await counting.run();
    expect(listed).toBe(1);
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    await PermitCheck.deleteMany({});
    await PermitCheck.insertMany(months.map((month) => ({ source: 'whatcom', month, method: 'report', checkedAt: clock, ok: true })));
    await counting.checkCountyReport();
    expect(listed).toBe(1);
  });

  it('doesn’t check months before the first pull’s start', async () => {
    report.month = '2026-03';
    await sync.run();
    expect(await PermitCheck.countDocuments({ method: 'report' })).toBe(0);
  });
});

describe('the month-so-far check', () => {
  it('finds every lead permit again a second way, for each source', async () => {
    const out = await sync.run();
    expect(out.monthToDate).toHaveLength(2);
    const w = await PermitCheck.findOne({ source: 'whatcom', month: '2026-10' }).lean();
    expect(w).toMatchObject({ method: 'search', ok: true, inSearch: 1, matched: 1, missingFromApp: [], notFoundAgain: [] });
    const b = await PermitCheck.findOne({ source: 'bellingham', month: '2026-10' }).lean();
    expect(b).toMatchObject({ method: 'search', ok: true, matched: 1 });
  });

  it('flags a permit the app has that the second search can’t find, and the other way round', async () => {
    await sync.run();
    // The app holds one the county no longer returns, and the county now has one the app hasn't pulled.
    whatcomRows = whatcomRows.filter((r) => r.CaseNumber !== 'SFR2026-00212');
    whatcomRows.push(wRow('SFR2026-00400', '2026-10-10'));
    const [w] = await sync.checkMonthToDate();
    expect(w).toMatchObject({ source: 'whatcom', ok: false, missingFromApp: ['SFR2026-00400'], notFoundAgain: ['SFR2026-00212'] });
  });

  it('never replaces a month’s county report check', async () => {
    await sync.run();
    clock = new Date('2026-09-20T19:00:00Z');
    await PermitCheck.create({ source: 'whatcom', month: '2026-09', method: 'report', checkedAt: clock, ok: true, matched: 5 });
    await sync.checkMonthToDate();
    const sep = await PermitCheck.find({ source: 'whatcom', month: '2026-09' }).lean();
    expect(sep).toHaveLength(1);
    expect(sep[0]).toMatchObject({ method: 'report', matched: 5 });
  });

  it('doesn’t count as the month’s report when the report comes', async () => {
    await sync.run();
    report.month = '2026-09';
    report.numbers = [];
    await PermitCheck.create({ source: 'whatcom', month: '2026-09', method: 'search', checkedAt: clock, ok: true });
    await sync.checkCountyReport();
    expect((await PermitCheck.findOne({ source: 'whatcom', month: '2026-09' }).lean()).method).toBe('report');
  });
});

describe('the API', () => {
  beforeEach(async () => {
    report.numbers = ['SFR2026-00100'];
    await sync.run();
  });

  it('needs the View permission', async () => {
    expect((await api('get', '/', NOBODY)).status).toBe(403);
    expect((await api('get', '/meta', NOBODY)).status).toBe(403);
    expect((await api('get', '/', VIEWER)).status).toBe(200);
  });

  it('lists newest issued first, with counts by category', async () => {
    const r = await api('get', '/?limit=2');
    expect(r.body.total).toBe(3);
    expect(r.body.items.map((p) => p.permitNumber)).toEqual(['SFR2026-00212', 'BLD2026-0001']);
    expect(r.body.counts).toMatchObject({ all: 3, new_home: 3, remodel: 0 });
    const page2 = await api('get', '/?limit=2&page=2');
    expect(page2.body.items.map((p) => p.permitNumber)).toEqual(['SFR2026-00100']);
  });

  it('filters by source, dates, city, value and search', async () => {
    expect((await api('get', '/?source=bellingham')).body.total).toBe(1);
    expect((await api('get', '/?from=2026-09-01&to=2026-10-31')).body.total).toBe(2);
    expect((await api('get', '/?city=Ferndale')).body.total).toBe(2);
    expect((await api('get', '/?minValue=400000')).body.total).toBe(1);
    expect((await api('get', '/?q=arrow')).body.items.map((p) => p.permitNumber)).toEqual(['SFR2026-00100']);
    expect((await api('get', '/?q=(')).status).toBe(200);
    expect((await api('get', '/?from=yesterday')).status).toBe(400);
    expect((await api('get', '/?category=pools')).status).toBe(400);
  });

  it('sorts by value, highest first or lowest first, with no-value permits last either way', async () => {
    await Permit.updateOne({ permitNumber: 'SFR2026-00100' }, { $set: { valuation: null } });
    const high = await api('get', '/?sort=value_desc');
    expect(high.body.items.map((p) => [p.permitNumber, p.valuation])).toEqual([['BLD2026-0001', 450000], ['SFR2026-00212', 300000], ['SFR2026-00100', null]]);
    const low = await api('get', '/?sort=value_asc');
    expect(low.body.items.map((p) => p.permitNumber)).toEqual(['SFR2026-00212', 'BLD2026-0001', 'SFR2026-00100']);
    expect((await api('get', '/?sort=issued_asc')).body.items[0].permitNumber).toBe('SFR2026-00100');
    expect((await api('get', '/export?sort=value_desc')).body.items[0].permitNumber).toBe('BLD2026-0001');
    expect((await api('get', '/?sort=sideways')).status).toBe(400);
    expect(high.body.items[0]._hasValue).toBeUndefined();
  });

  it('keeps the other categories’ counts when one is picked', async () => {
    const r = await api('get', '/?category=remodel');
    expect(r.body.total).toBe(0);
    expect(r.body.counts.new_home).toBe(3);
  });

  it('marks contacts who are already customers, by phone, email or exact company name', async () => {
    await Customer.create([
      { contactName: 'Vlad', email: 'vlad@other.com', phone: '(360) 739-7535', company: 'KVF' },
      { contactName: 'Pat', email: 'pat@raven.com', company: 'Raven Ridge Builders LLC' }
    ]);
    const r = await api('get', '/?limit=100');
    const by = Object.fromEntries(r.body.items.map((p) => [p.permitNumber, p.contacts[0].customer?.name || null]));
    expect(by).toEqual({ 'SFR2026-00212': 'KVF', 'BLD2026-0001': 'Raven Ridge Builders LLC', 'SFR2026-00100': null });
  });

  it('exports only with the Export permission', async () => {
    expect((await api('get', '/export', VIEWER)).status).toBe(403);
    const r = await api('get', '/export?source=whatcom');
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
  });

  it('makes the list a PDF for the same filters, only with the Export permission', async () => {
    const pdf = await api('get', '/export.pdf?source=whatcom').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe('inline; filename="permits-whatcom-start-to-today.pdf"');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await api('get', '/export.pdf?city=Ferndale&download=1')).headers['content-disposition']).toMatch(/^attachment; filename="permits-ferndale-/);
    expect((await api('get', '/export.pdf', VIEWER)).status).toBe(403);
    const bad = await api('get', '/export.pdf?from=yesterday');
    expect(bad.status).toBe(400);
    expect(bad.text).toBe('Dates must be YYYY-MM-DD.');
  });

  it('shows each source’s last run, with the run details only for Refresh', async () => {
    const admin = (await api('get', '/meta')).body;
    expect(admin.sources.map((s) => s.id)).toEqual(['whatcom', 'bellingham']);
    expect(admin.sources[1].lastRun.unsortedTypes).toHaveLength(1);
    expect(admin.sources[0].coverageSince).toBe('2026-04-11');
    expect(admin.checks.find((c) => c.method === 'report')).toMatchObject({ month: '2026-08', ok: true });
    expect(admin).toMatchObject({ canRefresh: true, canExport: true, running: false });
    expect(admin.cities).toEqual(['Bellingham', 'Ferndale']);
    const viewer = (await api('get', '/meta', VIEWER)).body;
    expect(viewer.sources[1].lastRun.unsortedTypes).toBeUndefined();
    expect(viewer).toMatchObject({ canRefresh: false, canExport: false });
  });

  it('runs the pull on demand only with Refresh', async () => {
    expect((await api('post', '/refresh', VIEWER)).status).toBe(403);
    const r = await api('post', '/refresh');
    expect(r.status).toBe(202);
    expect(r.body.started).toBe(true);
    await sync.run(); // the same run, already going
    const manual = await PermitRun.findOne({ kind: 'manual' }).lean();
    expect(manual).toMatchObject({ by: 'Krish', ok: true });
  });
});
