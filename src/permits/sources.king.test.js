// King County end to end against a real (throwaway, in-memory) MongoDB
// (2026-10-14): any source pulled the same way (details for leads only,
// recent ones reused), the county's monthly spreadsheet check and what it
// fills in, the API's county filter, and the WA contractor registry — looked
// up by license and by exact name, and shown beside the permit's contact.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createPermitsRouter from './router.js';
import { createPermitSync } from './sync.js';
import { Permit, PermitRun, PermitCheck, Contractor, ContractorName } from './models.js';
import { createContractorRegistry, licenseForName, wantedFrom, registryName } from './contractors.js';
import { ALL_PERMIT_PERMISSIONS } from './permissions.js';
import Customer from '../models/Customer.js';

let rs;
let clock;
const quiet = { log() {}, warn() {}, error() {} };
const ADMIN = { id: 'u1', displayName: 'Krish', permissions: [...ALL_PERMIT_PERMISSIONS] };
const msDay = (day) => `/Date(${Date.parse(`${day}T07:00:00Z`)})/`;
const mbpRow = (n, day, type) => ({ PermitNumber: n, PermitType: type, IssuedDate: msDay(day), Address: '1 MAIN ST', PermitStatus: 'Issued', PermitDescription: 'Work' });

let kingRows;
let detailCalls;
let burienRows;
const fakeKing = {
  issuedSince: async (since) => ({ rows: kingRows.filter((r) => r.day >= since).map((r) => r.row), pages: 1, total: kingRows.length }),
  details: async (n) => {
    detailCalls.push(n);
    return { people: [{ Name: 'ABC Homes', ContractorLicNum: 'ABCHOHL123AB', Type: 'Contractor' }], parcel: '1593001020', projectName: `P ${n}`, place: { city: 'North Bend', zip: '98045' } };
  }
};
const fakeBurien = { issuedSince: async () => ({ rows: burienRows, pages: 1, total: burienRows.length }), details: async () => ({ people: [{ Name: 'V N CONSTRUCTION LLC', Type: 'Contractor' }], parcel: '', projectName: '' }) };
const fakeWhatcom = {
  issuedSince: async () => ({ rows: [{ CaseId: 'c1', CaseNumber: 'SFR2026-00212', CaseType: 'Building (Residential) - SFR - New Construction', IssueDate: '2026-10-06T00:00:00', Address: { City: 'Ferndale' } }], pages: 1, total: 1 }),
  details: async () => ({ PermitNumber: 'SFR2026-00212', Contacts: [] })
};
let report;
const fakeKingReports = {
  list: async () => [{ month: report.month, title: `King County issued permits, ${report.month}`, url: 'https://example.com/k.xlsx' }],
  rows: async () => report.rows
};

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([Permit.init(), PermitRun.init(), PermitCheck.init(), Contractor.init(), ContractorName.init(), Customer.init()]);
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});

beforeEach(async () => {
  await Promise.all([Permit.deleteMany({}), PermitRun.deleteMany({}), PermitCheck.deleteMany({}), Contractor.deleteMany({}), ContractorName.deleteMany({})]);
  clock = new Date('2026-10-11T12:30:00Z');
  detailCalls = [];
  kingRows = [
    { day: '2026-09-16', row: mbpRow('ADDC25-0739', '2026-09-16', 'Building/Residential Building/Addition-Improvement') },
    { day: '2026-09-20', row: mbpRow('SFR26-0001', '2026-09-20', 'Building/Residential Building/Dwelling-Single/NA') },
    { day: '2026-09-21', row: mbpRow('MECH26-1', '2026-09-21', 'Building/Mechanical/Residential/NA') },
    { day: '2026-10-02', row: mbpRow('SFR26-0009', '2026-10-02', 'Building/Residential Building/Dwelling-Single/NA') }
  ];
  burienRows = [mbpRow('BLD26-2486', '2026-10-05', 'Residential - New')];
  report = {
    month: '2026-09',
    rows: [
      { number: 'ADDC25-0739', type: 'Building/Residential Building/Addition-Improvement/NA', project: 'GARAGE', issuedOn: '2026-09-16', valuation: 344212.8, parcel: '1593001020', city: 'North Bend', zip: '98045', units: null },
      { number: 'SFR26-0001', type: 'Building/Residential Building/Dwelling-Single/NA', project: '', issuedOn: '2026-09-20', valuation: 650000, parcel: '', city: 'North Bend', zip: '98045', units: 1 },
      { number: 'MECH26-1', type: 'Building/Mechanical/Residential/NA', project: '', issuedOn: '2026-09-21', valuation: null, parcel: '', city: 'Kent', zip: '', units: null }
    ]
  };
});

const makeSync = (extra = {}) => createPermitSync({ readers: { king_county: fakeKing, burien: fakeBurien }, kingReports: fakeKingReports, log: quiet, now: () => clock, ...extra });

describe('any source, pulled the same way', () => {
  it('reads each lead’s details once, then reuses them for a week', async () => {
    const sync = makeSync();
    const first = await sync.run();
    expect(first.king_county).toMatchObject({ ok: true, kind: 'backfill', seen: 4, leads: 3, added: 3, detailErrors: 0 });
    expect(detailCalls.sort()).toEqual(['ADDC25-0739', 'SFR26-0001', 'SFR26-0009']);
    const p = await Permit.findOne({ permitNumber: 'SFR26-0009' }).lean();
    expect(p).toMatchObject({ source: 'king_county', category: 'new_home', city: 'North Bend', zip: '98045', parcel: '1593001020' });
    expect(p.contacts[0]).toMatchObject({ kind: 'contractor', company: 'ABC Homes', license: 'ABCHOHL123AB' });

    detailCalls = [];
    clock = new Date('2026-10-12T12:30:00Z');
    const next = await sync.run();
    expect(next.king_county).toMatchObject({ ok: true, kind: 'daily', since: '2026-09-12', leads: 3, added: 0 });
    expect(detailCalls).toEqual([]);
    expect((await Permit.findOne({ permitNumber: 'SFR26-0009' }).lean()).contacts[0].license).toBe('ABCHOHL123AB');

    // Eight days on, the window (from Sep 20) holds two leads whose details are over a week old.
    clock = new Date('2026-10-20T12:30:00Z');
    await sync.run();
    expect(detailCalls.sort()).toEqual(['SFR26-0001', 'SFR26-0009']);
  });

  it('pulls only the sources it has readers for', async () => {
    const out = await makeSync().run();
    expect(Object.keys(out).filter((k) => !['reports', 'kingReports', 'monthToDate', 'contractors'].includes(k))).toEqual(['king_county', 'burien']);
    expect(out.monthToDate.map((c) => c.source)).toEqual(['king_county', 'burien']);
  });
});

describe('King County’s monthly spreadsheet', () => {
  it('matches a month permit by permit, fills in value and city, and ignores non-leads', async () => {
    await makeSync().run();
    const check = await PermitCheck.findOne({ source: 'king_county', month: '2026-09' }).lean();
    expect(check).toMatchObject({ method: 'report', ok: true, inReport: 3, matched: 2, missingFromApp: [], notInReport: [], filled: 2 });
    expect(await Permit.findOne({ permitNumber: 'ADDC25-0739' }).lean()).toMatchObject({ valuation: 344212.8, city: 'North Bend' });
    expect(await Permit.findOne({ permitNumber: 'SFR26-0001' }).lean()).toMatchObject({ valuation: 650000, units: 1 });
  });

  it('lists a lead the report has that the pull didn’t', async () => {
    report.rows.push({ number: 'ADU26-0005', type: 'Building/Residential Building/Dwelling-ADU/NA', project: '', issuedOn: '2026-09-25', valuation: 90000, parcel: '', city: '', zip: '', units: 1 });
    await makeSync().run();
    expect(await PermitCheck.findOne({ source: 'king_county', month: '2026-09' }).lean()).toMatchObject({ ok: false, missingFromApp: ['ADU26-0005'], addedFromReport: ['ADU26-0005'] });
    // …and saves it from the report, so it's on the list; the next morning's check comes out clean.
    expect(await Permit.findOne({ permitNumber: 'ADU26-0005' }).lean()).toMatchObject({ source: 'king_county', category: 'adu', valuation: 90000, issuedOn: '2026-09-25' });
    clock = new Date('2026-10-12T12:30:00Z');
    await makeSync().run();
    expect(await PermitCheck.findOne({ source: 'king_county', month: '2026-09' }).lean()).toMatchObject({ ok: true, missingFromApp: [] });
  });

  it('never runs without the county’s reader', async () => {
    const sync = createPermitSync({ readers: { burien: fakeBurien }, kingReports: fakeKingReports, log: quiet, now: () => clock });
    await sync.run();
    expect(await PermitCheck.countDocuments({ method: 'report' })).toBe(0);
  });
});

describe('the WA contractor registry', () => {
  const lni = (rows) => {
    const calls = [];
    const fetchImpl = async (url) => {
      const where = new URL(url).searchParams.get('$where');
      calls.push(where);
      const hit = rows.filter((r) => where.includes(`'${r.contractorlicensenumber}'`) || where.includes(`'${registryName(r.businessname)}'`));
      return { ok: true, status: 200, text: async () => JSON.stringify(hit) };
    };
    return { fetchImpl, calls };
  };
  const ROWS = [
    { businessname: 'ABC HOMES LLC', contractorlicensenumber: 'ABCHOHL123AB', phonenumber: '4255550100', statuscode: 'A', contractorlicensestatus: 'ACTIVE', specialtycode1desc: 'GENERAL', city: 'KENT', state: 'WA', zip: '98030' },
    { businessname: 'V N CONSTRUCTION LLC', contractorlicensenumber: 'VNCONCL900AA', phonenumber: '2536321912', statuscode: 'A', contractorlicensestatus: 'ACTIVE' },
    { businessname: 'SMITH CONSTRUCTION', contractorlicensenumber: 'SMITHCC111AA', statuscode: 'A' },
    { businessname: 'SMITH CONSTRUCTION', contractorlicensenumber: 'SMITHCC222BB', statuscode: 'A' }
  ];

  it('takes a name’s one active license, and nothing when there are several', () => {
    expect(licenseForName(ROWS.filter((r) => r.businessname === 'SMITH CONSTRUCTION'))).toEqual({ license: '', candidates: 2 });
    expect(licenseForName([{ ...ROWS[1] }, { ...ROWS[1], contractorlicensenumber: 'OLD', statuscode: 'E', contractorlicensestatus: 'EXPIRED' }])).toEqual({ license: 'VNCONCL900AA', candidates: 1 });
    expect(wantedFrom([
      { kind: 'contractor', company: 'X', license: 'abchohl123ab' }, { kind: 'contractor', company: 'V N Construction LLC' },
      { kind: 'contractor', company: 'TBD' }, { kind: 'owner', company: 'Pat Owner' }
    ])).toEqual({ licenses: ['ABCHOHL123AB'], names: ['V N CONSTRUCTION LLC'] });
  });

  it('reads licenses and exact names after the pull, then shows them beside the contact', async () => {
    const reg = lni(ROWS);
    const sync = makeSync({ contractors: createContractorRegistry({ fetchImpl: reg.fetchImpl, sleep: async () => {}, now: () => clock, log: quiet }) });
    const out = await sync.run();
    expect(out.contractors).toEqual({ licensesRead: 1, namesLookedUp: 1, namesMatched: 1 });
    expect(await Contractor.findOne({ license: 'ABCHOHL123AB' }).lean()).toMatchObject({ businessName: 'ABC HOMES LLC', phone: '4255550100', status: 'ACTIVE' });

    // Read again the next morning: nothing new to ask the registry.
    clock = new Date('2026-10-12T12:30:00Z');
    reg.calls.length = 0;
    expect((await sync.run()).contractors).toEqual({ licensesRead: 0, namesLookedUp: 0, namesMatched: 0 });
    expect(reg.calls).toEqual([]);

    const app = express();
    app.use('/api/permits', createPermitsRouter({ sync, customerIndexMs: 0, authenticate: (req, res, next) => { req.user = ADMIN; next(); } }));
    const r = await request(app).get('/api/permits?limit=100');
    const by = Object.fromEntries(r.body.items.map((p) => [p.permitNumber, p.contacts[0]]));
    expect(by['SFR26-0009'].registry).toMatchObject({ matchedBy: 'license', license: 'ABCHOHL123AB', businessName: 'ABC HOMES LLC', phone: '4255550100', status: 'ACTIVE' });
    expect(by['SFR26-0009'].phone).toBe('');   // the source's own contact is never changed
    expect(by['BLD26-2486'].registry).toMatchObject({ matchedBy: 'name', phone: '2536321912' });
  });

  it('records a license the registry doesn’t have, and never shows it', async () => {
    const sync = makeSync({ contractors: createContractorRegistry({ fetchImpl: lni([]).fetchImpl, sleep: async () => {}, now: () => clock, log: quiet }) });
    await sync.run();
    expect(await Contractor.findOne({ license: 'ABCHOHL123AB' }).lean()).toMatchObject({ notFound: true });
  });

  it('never fails the pull when the registry is down', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'down' });
    const out = await makeSync({ contractors: createContractorRegistry({ fetchImpl, sleep: async () => {}, now: () => clock, log: quiet }) }).run();
    expect(out.king_county.ok).toBe(true);
    expect(out.contractors.error).toMatch(/503|JSON/);
  });
});

describe('the API’s counties', () => {
  let app;
  beforeEach(async () => {
    const sync = createPermitSync({ readers: { king_county: fakeKing, burien: fakeBurien, whatcom: fakeWhatcom }, log: quiet, now: () => clock });
    await sync.run();
    app = express();
    app.use('/api/permits', createPermitsRouter({ sync, customerIndexMs: 0, authenticate: (req, res, next) => { req.user = ADMIN; next(); } }));
  });
  const get = (url) => request(app).get(`/api/permits${url}`);

  it('filters by county, and by county and issuer together', async () => {
    expect((await get('/')).body.total).toBe(5);
    expect((await get('/?counties=king')).body.total).toBe(4);
    expect((await get('/?counties=whatcom')).body.total).toBe(1);
    expect((await get('/?counties=king,whatcom')).body.total).toBe(5);
    expect((await get('/?counties=king&source=burien')).body.total).toBe(1);
    expect((await get('/?counties=whatcom&source=burien')).body.total).toBe(0);
    expect((await get('/?counties=adams')).body.total).toBe(0);
    expect((await get('/?counties=atlantis')).status).toBe(400);
  });

  it('lists the sources it pulls and each city’s county', async () => {
    const meta = (await get('/meta')).body;
    expect(meta.sources.map((s) => s.id)).toEqual(['king_county', 'burien', 'whatcom']);
    expect(meta.sources[0]).toMatchObject({ county: 'king', countyLabel: 'King County', kind: 'county' });
    expect(meta.cityCounties).toEqual({ Burien: ['king'], Ferndale: ['whatcom'], 'North Bend': ['king'] });
  });

  it('names the PDF and its heading after the counties', async () => {
    const pdf = await get('/export.pdf?counties=king,whatcom');
    expect(pdf.headers['content-disposition']).toBe('inline; filename="permits-king-whatcom-start-to-today.pdf"');
  });
});
