/**
 * Permits' reads, through the real router, on MongoDB and on Postgres (PGlite) holding the same data: every filter, sort,
 * the counts, cities, the contractor pop-up, the export and the PDF must answer the same, contact order included.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import createPermitsRouter from '../../permits/router.ts';
import { Permit, PermitRun, PermitCheck, Contractor, ContractorName } from '../../permits/models.ts';
import Customer from '../../models/Customer.ts';
import { ALL_PERMIT_PERMISSIONS, PERMITS } from '../../permits/permissions.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

const ADMIN = { id: 'u1', displayName: 'Krish', permissions: [...ALL_PERMIT_PERMISSIONS] };
const VIEWER = { id: 'u2', displayName: 'Maria', permissions: [PERMITS.VIEW] };

let t: WriteParity;
let app: ReturnType<typeof express>;

const contact = (kind: string, company: string, extra: Loose = {}) => ({ role: kind, kind, company, name: '', phone: '', email: '', address: '', ...extra });
let n = 0;
const permit = (o: Loose) => ({
  source: 'seattle', permitNumber: `P-${String(++n).padStart(3, '0')}`, category: 'new_home', issuedOn: '2026-10-01', city: 'Seattle',
  valuation: 100000, address: `${n} Pine St`, description: '', parcel: '', contacts: [], firstSeenAt: new Date('2026-10-02T10:00:00Z'), lastSeenAt: new Date('2026-10-05T10:00:00Z'), ...o
});

const PERMIT_ROWS = [
  permit({ permitNumber: 'A-1', issuedOn: '2026-10-09', valuation: 450000, address: '10 Oak St', description: 'New SFR 100% done', contacts: [
    contact('owner', 'Owner One', { name: 'Olive Owner', email: 'olive@x.test' }),
    contact('contractor', 'Raven Ridge Builders LLC', { name: 'Ray', email: 'Ray@Raven.test', phone: '360-555-0100', license: 'RAVENR*123AB' }),
    contact('applicant', '', { name: 'Zed Applicant' })] }),
  permit({ permitNumber: 'A-2', issuedOn: '2026-10-09', valuation: 450000, source: 'king_county', city: 'Bellevue', contacts: [contact('contractor', 'Raven Ridge Builders LLC', { email: 'ray@raven.test', license: 'RAVENR*123AB' })] }),
  permit({ permitNumber: 'B-1', issuedOn: '2026-10-09', valuation: 300000, source: 'bellingham', city: 'Bellingham', category: 'remodel', contacts: [contact('contractor', 'Raven Ridge Builders LLC'), contact('contractor', 'Other Co', { license: 'OTHERCO999ZZ' })] }),
  permit({ permitNumber: 'B-2', issuedOn: '2026-09-20', valuation: null, source: 'whatcom', city: 'Ferndale', category: 'adu', parcel: 'P_100%' }),
  permit({ permitNumber: 'B-3', issuedOn: '2026-09-25', valuation: 0, source: 'whatcom', city: 'Ferndale', category: 'addition', address: 'Back_Lot (rear)' }),
  permit({ permitNumber: 'C-1', issuedOn: '2026-08-04', valuation: 250000, source: 'skagit_county', city: 'Mount Vernon', category: 'new_home', contacts: [contact('contractor', 'raven ridge builders llc', { email: 'ray@raven.test' })] }),
  permit({ permitNumber: 'C-2', issuedOn: '2026-08-04', valuation: 250000, source: 'whatcom', city: 'Blaine', category: 'commercial_new', description: 'Tenant\\path' }),
  permit({ permitNumber: 'C-3', issuedOn: '2026-08-04', valuation: 75000, city: 'Seattle', category: 'commercial_remodel', contacts: [contact('contractor', 'Seattle Stone Co', { email: 'stone@x.test', license: 'SEATTSC111AA' })] }),
  permit({ permitNumber: 'D-1', issuedOn: null, valuation: 999999, city: 'Seattle', description: 'Source withdrew the issue date', contacts: [contact('contractor', 'Raven Ridge Builders LLC', { license: 'RAVENR*123AB' })] }),
  permit({ permitNumber: 'E-1', issuedOn: '2026-07-15', valuation: 12.5, city: '', category: 'building_other', contacts: [contact('contractor', 'No City Co', { phone: '2065550101' })] }),
  ...Array.from({ length: 6 }, (_, i) => permit({ permitNumber: `F-${i}`, issuedOn: `2026-06-0${i + 1}`, valuation: 1000 * (i + 1), source: 'kitsap_county', city: 'Port Orchard', category: 'new_home' }))
];

const as = (user: Loose) => (path: string) => request(app).get(`/api/permits${path}`).set('x-test-user', JSON.stringify(user)).buffer(true).parse((res: Loose, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Uint8Array[] = [];
  res.on('data', (c: Uint8Array) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

/** One request on both databases: [mongo answer, postgres answer] (status, JSON body, the headers a screen reads). */
async function ask(path: string, user: Loose = ADMIN) {
  const run = async () => {
    const r = await as(user)(path);
    const isPdf = String(r.headers['content-type']).includes('pdf');
    return { status: r.status, type: r.headers['content-type'], disposition: r.headers['content-disposition'], body: isPdf ? { pdf: r.body.subarray(0, 5).toString(), big: r.body.length > 500 } : String(r.headers['content-type']).includes('json') ? JSON.parse(r.body.toString() || 'null') : r.body.toString() };
  };
  const mongo = await t.on('mongo', run);
  const postgres = await t.on('postgres', run);
  expect(postgres).toEqual(mongo);
  return mongo;
}

beforeAll(async () => {
  t = await openWriteParity(async () => {
    await Promise.all([Permit.init(), PermitRun.init(), PermitCheck.init(), Contractor.init(), ContractorName.init(), Customer.init()]);
    await Permit.insertMany(PERMIT_ROWS);
    const at = (d: string) => new Date(`${d}T12:00:00Z`);
    await PermitRun.insertMany([
      { source: 'seattle', kind: 'backfill', since: '2026-04-11', startedAt: at('2026-10-01'), finishedAt: at('2026-10-01'), ok: true, seen: 9, leads: 7, added: 7, latestIssuedOn: '2026-10-01' },
      { source: 'seattle', kind: 'daily', since: '2026-09-11', startedAt: at('2026-10-10'), finishedAt: at('2026-10-10'), ok: true, seen: 4, leads: 3, updated: 1, by: 'schedule', unsortedTypes: [{ type: 'Hot Tub', count: 2 }] },
      { source: 'seattle', kind: 'manual', since: '2026-09-11', startedAt: at('2026-10-11'), finishedAt: at('2026-10-11'), ok: false, error: 'Portal down', by: 'Krish' },
      { source: 'whatcom', kind: 'daily', since: '2026-09-11', startedAt: at('2026-10-10'), ok: true },
      { source: 'whatcom', kind: 'backfill', since: '2026-04-12', startedAt: at('2026-04-12'), finishedAt: at('2026-04-12'), ok: true },
      { source: 'whatcom', kind: 'backfill', since: '2026-04-11', startedAt: at('2026-04-11'), finishedAt: at('2026-04-11'), ok: true }
    ]);
    await PermitCheck.insertMany([
      { source: 'seattle', month: '2026-10', method: 'search', checkedAt: at('2026-10-10'), inSearch: 8, notFoundAgain: ['A-1'], ok: true },
      { source: 'whatcom', month: '2026-10', method: 'search', checkedAt: at('2026-10-10'), inSearch: 2, ok: true },
      { source: 'whatcom', month: '2026-08', method: 'report', checkedAt: at('2026-09-02'), inReport: 3, matched: 3, reportTitle: 'Aug', reportUrl: 'https://x.test/r.pdf', ok: true },
      { source: 'king_county', month: '2026-08', method: 'report', checkedAt: at('2026-09-02'), inReport: 2, matched: 1, missingFromApp: ['K-1'], filled: 1, ok: false, error: 'one missing' }
    ]);
    await Contractor.insertMany([{ license: 'RAVENR*123AB', businessName: 'Raven Ridge Builders LLC', phone: '3605550100', status: 'ACTIVE', expiresOn: '2027-01-01', refreshedAt: at('2026-10-01') }]);
    await ContractorName.insertMany([{ name: 'RAVEN RIDGE BUILDERS LLC', license: 'RAVENR*123AB', candidates: 1, checkedAt: at('2026-10-01') }]);
    await Customer.create({ contactName: 'Ray', company: 'Raven Ridge Builders LLC', email: 'ray@raven.test' });
  }, 'DB_PERMITS');
  app = express();
  app.use(express.json());
  app.use('/api/permits', createPermitsRouter({
    sync: { sourceIds: () => ['seattle', 'whatcom', 'bellingham', 'king_county'], isRunning: async () => false },
    customerIndexMs: 0,
    contractors: { profile: async (license: string) => ({ found: license === 'RAVENR*123AB', license, businessName: 'Raven Ridge Builders LLC', phone: '3605550100' }) },
    authenticate: (req: Loose, res: Loose, next: () => void) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'Not signed in.' });
      req.user = JSON.parse(raw);
      return next();
    }
  }));
}, 240000);
afterAll(async () => { await t?.close(); await mongoose.disconnect(); });

const numbers = (r: { body: Loose }) => r.body.items.map((p: Loose) => p.permitNumber);

describe('the list', () => {
  it('is newest issued first, no withdrawn issue date, with the same counts and total', async () => {
    const r = await ask('/?limit=100');
    expect(r.body.total).toBe(15);
    expect(numbers(r)).not.toContain('D-1');
    expect(r.body.counts.all).toBe(15);
    const first = r.body.items.find((p: Loose) => p.permitNumber === 'A-1');
    expect(first.contacts.map((c: Loose) => c.kind)).toEqual(['owner', 'contractor', 'applicant']);
    expect(first.contacts[1].registry).toBeTruthy();
    expect(first.contacts[1].customer).toBeTruthy();
    expect(first.contacts[0].license).toBeUndefined();
  });
  it('pages the same', async () => {
    const first = await ask('/?limit=4');
    expect(numbers(first)).toHaveLength(4);
    await ask('/?limit=4&page=2');
    await ask('/?limit=4&page=4');
    await ask('/?limit=4&page=99');
    await ask('/');
  });
  it('sorts every way, ties and no-value permits included', async () => {
    for (const sort of ['issued_desc', 'issued_asc', 'value_desc', 'value_asc']) await ask(`/?limit=100&sort=${sort}`);
    const low = await ask('/?limit=100&sort=value_asc');
    expect(numbers(low).slice(-2)).toEqual(['B-2', 'B-3']);
    expect(numbers(await ask('/?limit=100&sort=value_desc')).slice(-2)).toEqual(['B-3', 'B-2']);
    expect((await ask('/?sort=sideways')).status).toBe(400);
  });
  it('filters by source, county, category, dates, city, value and search', async () => {
    const queries = [
      '?source=whatcom', '?source=whatcom&counties=king', '?source=whatcom&counties=whatcom', '?counties=king', '?counties=king,skagit', '?counties=pierce',
      '?category=remodel', '?category=new_home&sort=value_desc', '?from=2026-09-01', '?to=2026-09-30', '?from=2026-08-04&to=2026-08-04', '?from=2026-10-09&to=2026-10-09',
      '?city=Ferndale', '?city=Seattle', '?minValue=300000', '?minValue=0', '?minValue=12.5', '?minValue=nope', '?from=yesterday', '?category=pools', '?counties=mars', '?source=nowhere',
      '?q=oak', '?q=OAK%20ST', '?q=raven', '?q=ray%40raven.test', '?q=olive', '?q=zed', '?q=RAVENR*123AB', '?q=ravenr*123ab', '?q=100%25', '?q=P_100', '?q=_', '?q=%25',
      '?q=(', '?q=Tenant%5Cpath', '?q=Back_Lot%20(rear)', '?q=P-00', '?q=A-1', '?q=%20%20', '?q=stone', '?q=seattle%20stone&category=commercial_remodel', '?q=raven&source=king_county&minValue=1'
    ];
    for (const q of queries) await ask(`/${q}${q.includes('limit') ? '' : (q.includes('?') ? '&' : '?')}limit=100`);
    expect(numbers(await ask('/?q=100%25&limit=100'))).toEqual(['A-1', 'B-2']);
    expect((await ask('/?q=P_100&limit=100')).body.total).toBe(1);
  });
  it('filters by a contractor license, with or without the names the registry matched', async () => {
    const byLicense = await ask('/?license=ravenr*123ab&limit=100');
    expect(numbers(byLicense)).toEqual(['B-1', 'A-2', 'A-1', 'C-1']);
    await ask('/?license=OTHERCO999ZZ&limit=100');
    await ask('/?license=NOSUCH000XX&limit=100');
    await ask('/?license=RAVENR*123AB&counties=king&category=new_home&limit=100');
    await ask('/?license=nope');
    await ask('/?license=RAVENR*123AB&q=oak&sort=value_desc');
  });
});

describe('the rest of the screen', () => {
  it('exports every permit the filters match, in the same order', async () => {
    for (const q of ['', '?source=whatcom', '?sort=value_asc&counties=king', '?license=RAVENR*123AB']) await ask(`/export${q}`);
    expect((await ask('/export', VIEWER)).status).toBe(403);
    expect((await ask('/export?from=yesterday')).status).toBe(400);
  });
  it('makes the PDF', async () => {
    const r = await ask('/export.pdf?source=whatcom');
    expect(r.body).toEqual({ pdf: '%PDF-', big: true });
    await ask('/export.pdf?city=Seattle&download=1&sort=value_desc');
    expect((await ask('/export.pdf?from=yesterday')).status).toBe(400);
  });
  it('shows the header: each source’s runs, the checks, the cities and which counties they sit in', async () => {
    const r = await ask('/meta');
    expect(r.body.sources.map((s: Loose) => s.id)).toEqual(['seattle', 'whatcom', 'bellingham', 'king_county']);
    expect(r.body.sources[0].lastRun.error).toBe('Portal down');
    expect(r.body.sources[0].lastOk.kind).toBe('daily');
    expect(r.body.sources[0].lastOk.unsortedTypes).toEqual([{ type: 'Hot Tub', count: 2 }]);
    expect(r.body.sources[1].coverageSince).toBe('2026-04-11');
    expect(r.body.sources[2].lastRun).toBeNull();
    expect(r.body.cities).toContain('Port Orchard');
    expect(r.body.cityCounties.Seattle).toEqual(['king']);
    await ask('/meta', VIEWER);
  });
  it('shows the contractor pop-up’s permits, categories and emails', async () => {
    const r = await ask('/contractor/ravenr*123ab');
    expect(r.body.permits.total).toBe(4);
    expect(r.body.emails).toEqual(['ray@raven.test']);
    expect(r.body.customer).toBeTruthy();
    expect(r.body.permits.recent.map((p: Loose) => p.permitNumber)).toEqual(['B-1', 'A-2', 'A-1', 'C-1']);
    await ask('/contractor/OTHERCO999ZZ');
    await ask('/contractor/SEATTSC111AA');
    await ask('/contractor/NOSUCH000XX');
    expect((await ask('/contractor/!!')).status).toBe(400);
  });
});
