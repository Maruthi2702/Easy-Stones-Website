/**
 * Permits' pull and registry cache: every write run on MongoDB, then on Postgres, must answer the same and leave the same rows
 * in every permit table (the copy's own check against MongoDB is the spec). The pull is the real one (src/permits/sync.ts)
 * over fake readers, so the add, update, issue-date-cleared and contacts-changed cases are what a morning does.
 */
import { sql } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import { createPermitSync } from '../../permits/sync.ts';
import { createContractorRegistry, namesForLicense, registryLookup, registryName } from '../../permits/contractors.ts';
import { permitSyncOnLambda } from '../../permits/syncOnLambda.ts';
import { RULES } from '../../permits/permitRules.ts';
import { Permit, PermitRun, PermitCheck, Contractor, ContractorName } from '../../permits/models.ts';
import * as permitsDb from './writes.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 120_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new row's id is made by the data layer: both runs of one call must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

let t: WriteParity;
beforeAll(async () => {
  t = await openWriteParity(async () => {
    await Promise.all([Permit.init(), PermitRun.init(), PermitCheck.init(), Contractor.init(), ContractorName.init()]);
  }, 'DB_PERMITS');
  // One detail page at a time, so the saves (and the ids they take) happen in the same order on both databases.
  (RULES.king_county as Loose).detailConcurrency = 1;
  (RULES.burien as Loose).detailConcurrency = 1;
}, 240000);
afterAll(async () => { await t?.close(); });

/** Both databases, same answer (after JSON), same rows. */
async function same<T>(run: () => Promise<T>, tidy: (v: T) => unknown = v => v) {
  ids.made.length = 0;
  const { mongo, postgres } = await t.both(async () => { ids.used = 0; return JSON.parse(JSON.stringify(await run() ?? null)); });
  expect(normalize(tidy(postgres as T))).toEqual(normalize(tidy(mongo as T)));
  expect(await t.differences()).toEqual([]);
  return mongo as T;
}
const noRunIds = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === '_id' || k === '__v' ? undefined : x)));

const quiet = { log() {}, warn() {}, error() {} };
let clock = new Date('2026-10-11T12:30:00Z');
const msDay = (day: string) => `/Date(${Date.parse(`${day}T07:00:00Z`)})/`;
const mbpRow = (n: string, day: string, type: string, status = 'Issued') => ({ PermitNumber: n, PermitType: type, IssuedDate: msDay(day), Address: '1 MAIN ST', PermitStatus: status, PermitDescription: 'Work' });
const HOME = 'Building/Residential Building/Dwelling-Single/NA';
let kingRows: { day: string; row: Loose }[] = [];
let peopleOf: (n: string) => Loose[] = () => [{ Name: 'ABC Homes', ContractorLicNum: 'ABCHOHL123AB', Type: 'Contractor' }];
const fakeKing = {
  issuedSince: async (since: string) => ({ rows: kingRows.filter(r => r.day >= since).map(r => r.row), pages: 1, total: kingRows.length }),
  details: async (n: string) => ({ people: peopleOf(n), parcel: '1593001020', projectName: `P ${n}`, place: { city: 'North Bend', zip: '98045' } })
};
let burienRows: Loose[] = [];
const fakeBurien = { issuedSince: async () => ({ rows: burienRows, pages: 1, total: burienRows.length }), details: async () => ({ people: [{ Name: 'V N CONSTRUCTION LLC', Type: 'Contractor' }], parcel: '', projectName: '' }) };
let report: Loose = { month: '2026-09', rows: [] };
const fakeKingReports = {
  list: async () => [{ month: report.month, title: `King County issued permits, ${report.month}`, url: 'https://example.com/k.xlsx' }],
  rows: async () => report.rows
};
const REGISTRY = [
  { businessname: 'ABC HOMES LLC', contractorlicensenumber: 'ABCHOHL123AB', phonenumber: '4255550100', statuscode: 'A', contractorlicensestatus: 'ACTIVE', specialtycode1desc: 'GENERAL', city: 'KENT', state: 'WA', zip: '98030', licenseexpirationdate: '2027-03-01T00:00:00.000' },
  { businessname: 'V N CONSTRUCTION LLC', contractorlicensenumber: 'VNCONCL900AA', phonenumber: '2536321912', statuscode: 'A', contractorlicensestatus: 'ACTIVE' }
];
const fetchImpl = async (url: string) => {
  const u = new URL(url);
  const where = u.searchParams.get('$where') ?? '';
  const lic = u.searchParams.get('contractorlicensenumber');
  const hit = REGISTRY.filter(r => lic ? r.contractorlicensenumber === lic : where.includes(`'${r.contractorlicensenumber}'`) || where.includes(`'${registryName(r.businessname)}'`));
  return { ok: true, status: 200, text: async () => JSON.stringify(u.pathname.includes('m8qx-ubtq') ? hit : []) };
};
const contractors = () => createContractorRegistry({ fetchImpl: fetchImpl as never, sleep: async () => {}, now: () => clock, log: quiet });
const makeSync = () => createPermitSync({ readers: { king_county: fakeKing, burien: fakeBurien }, kingReports: fakeKingReports, contractors: contractors(), log: quiet, now: () => clock });

describe('a pull', () => {
  const sync = makeSync();
  it('adds permits with their contacts, the first morning (backfill, checks, registry)', async () => {
    kingRows = [
      { day: '2026-09-16', row: mbpRow('ADDC25-0739', '2026-09-16', 'Building/Residential Building/Addition-Improvement/NA') },
      { day: '2026-09-20', row: mbpRow('SFR26-0001', '2026-09-20', HOME) },
      { day: '2026-10-02', row: mbpRow('SFR26-0009', '2026-10-02', HOME) }
    ];
    burienRows = [mbpRow('BLD26-2486', '2026-10-05', 'Residential - New')];
    report = { month: '2026-09', rows: [
      { number: 'ADDC25-0739', type: 'Building/Residential Building/Addition-Improvement/NA', project: 'GARAGE', issuedOn: '2026-09-16', valuation: 344212.8, parcel: '1593001020', city: 'North Bend', zip: '98045', units: null },
      { number: 'SFR26-0001', type: HOME, project: '', issuedOn: '2026-09-20', valuation: 650000, parcel: '', city: 'North Bend', zip: '98045', units: 1 },
      { number: 'ADU26-0005', type: 'Building/Residential Building/Dwelling-ADU/NA', project: '', issuedOn: '2026-09-25', valuation: 90000, parcel: '', city: '', zip: '', units: 1 }
    ] };
    const out = await same(() => sync.run(), v => noRunIds(v));
    expect((out as Loose).king_county).toMatchObject({ ok: true, kind: 'backfill', added: 3 });
    expect((out as Loose).contractors).toMatchObject({ licensesRead: 1, namesMatched: 1 });
    // the rows really are in Postgres (the comparison above would pass on two empty databases)
    const [{ n }] = (await t.pg.db.execute(sql`select count(*)::int as n from permits`) as unknown as { rows: { n: number }[] }).rows;
    expect(n).toBeGreaterThanOrEqual(4);
    const [{ c }] = (await t.pg.db.execute(sql`select count(*)::int as c from permit_contacts`) as unknown as { rows: { c: number }[] }).rows;
    expect(c).toBeGreaterThan(0);
  });

  it('updates a permit whose status changed and one whose contacts changed; counts only real changes', async () => {
    clock = new Date('2026-10-12T12:30:00Z');
    kingRows[2].row = mbpRow('SFR26-0009', '2026-10-02', HOME, 'Finaled');
    const out = await same(() => sync.run(), v => noRunIds(v));
    expect((out as Loose).king_county).toMatchObject({ ok: true, kind: 'daily' });
    // eight days on: details are over a week old and are read again, with other people on the permit
    clock = new Date('2026-10-20T12:30:00Z');
    peopleOf = n => [{ Name: n === 'SFR26-0001' ? 'New Builder Inc' : 'ABC Homes', ContractorLicNum: n === 'SFR26-0001' ? '' : 'ABCHOHL123AB', Type: 'Contractor' }, { Name: 'Pat Owner', Type: 'Owner' }];
    const next = await same(() => sync.run(), v => noRunIds(v));
    expect((next as Loose).king_county.updated).toBeGreaterThan(0);
  });

  it('a pull that fails records the error and closes the run', async () => {
    clock = new Date('2026-10-21T12:30:00Z');
    kingRows = [];
    await same(() => sync.run(), v => noRunIds(v));
  });
});

describe('saving permits directly', () => {
  const base = { source: 'king_county', category: 'new_home', type: 'Single', status: 'Issued', issuedOn: '2026-10-02', address: '9 Oak St', valuation: 100, contacts: [{ role: 'Owner', kind: 'owner', name: 'Pat' }, { role: 'Contractor', kind: 'contractor', company: 'ABC', license: 'ABCHOHL123AB' }] };
  const at = new Date('2026-10-22T10:00:00Z');
  it('adds, leaves an unchanged one alone, then updates one field, the contacts, and clears the issue date', async () => {
    const save = (p: Loose, detailsRead = false) => permitsDb.savePermits('king_county', [p], { at, detailsRead });
    expect(await same(() => save({ ...base, permitNumber: 'X1' }, true))).toEqual({ added: 1, updated: 0 });
    expect(await same(() => save({ ...base, permitNumber: 'X1' }))).toEqual({ added: 0, updated: 0 });
    expect(await same(() => save({ ...base, permitNumber: 'X1', status: 'Finaled' }))).toEqual({ added: 0, updated: 1 });
    expect(await same(() => save({ permitNumber: 'X1', contacts: [{ role: 'Owner', kind: 'owner', name: 'Pat Jr' }] }))).toEqual({ added: 0, updated: 1 });
    // contacts left out: kept as they are
    expect(await same(() => save({ permitNumber: 'X1', address: '10 Oak St' }))).toEqual({ added: 0, updated: 1 });
    // the office cleared the issue date: kept, as null
    expect(await same(() => save({ permitNumber: 'X1', issuedOn: null }))).toEqual({ added: 0, updated: 1 });
    // a category only for a permit the app doesn't hold yet
    expect(await same(() => save({ source: 'king_county', permitNumber: 'X2', category: undefined, categoryIfNew: 'multifamily', issuedOn: '2026-10-03' }))).toEqual({ added: 1, updated: 0 });
    expect(await same(() => save({ permitNumber: 'X2', category: undefined, categoryIfNew: 'adu', issuedOn: '2026-10-03' }))).toEqual({ added: 0, updated: 0 });
    // several at once, one new
    expect(await same(() => permitsDb.savePermits('king_county', [{ ...base, permitNumber: 'X3', valuation: null }, { ...base, permitNumber: 'X1', issuedOn: '2026-10-02' }], { at }))).toEqual({ added: 1, updated: 1 });
  });
  it('answers the numbers, the held permits and the contacts seen', async () => {
    const day = (n: string) => ({ issuedFrom: '2026-10-01', issuedTo: '2026-10-02', ...(n ? { among: [n] } : {}) });
    const sorted = (v: unknown) => [...(v as string[])].sort();
    expect(sorted(await same(() => permitsDb.syncPermitNumbers('king_county', day(''))))).toContain('X1');
    await same(() => permitsDb.syncPermitNumbers('king_county', { among: ['X1', 'X3', 'nope'] }), sorted);
    await same(() => permitsDb.syncPermitNumbers('king_county'), sorted);
    await same(() => permitsDb.syncPermitNumbersDetailedSince('king_county', ['X1', 'X3'], new Date('2026-10-01T00:00:00Z')), sorted);
    await same(() => permitsDb.syncPermitsHeld('king_county', ['X1', 'X3']), v => (v as Loose[]).map((p): Loose => ({ ...p, _id: undefined })).sort((a, b) => a.permitNumber.localeCompare(b.permitNumber)));
    await same(() => permitsDb.syncContactsSeenSince(at), v => JSON.stringify((v as Loose[]).map(c => JSON.stringify(c)).sort()));
  });
  it('fills only what it is told to', async () => {
    const [held] = (await permitsDb.syncPermitsHeld('king_county', ['X3'])) as Loose[];
    await t.on('mongo', () => permitsDb.syncFillPermits([{ id: held._id, fill: { valuation: 5000, city: 'Kent' } }]));
    const [heldPg] = await t.on('postgres', () => permitsDb.syncPermitsHeld('king_county', ['X3'])) as Loose[];
    await t.on('postgres', () => permitsDb.syncFillPermits([{ id: heldPg._id, fill: { valuation: 5000, city: 'Kent' } }]));
    expect(await t.differences()).toEqual([]);
  });
});

describe('runs and checks', () => {
  const t0 = new Date('2026-10-23T09:00:00Z');
  it('starts, finishes, fails, finds and closes runs', async () => {
    const started = await same(() => permitsDb.syncStartRun({ source: 'burien', kind: 'daily', since: '2026-09-23', startedAt: t0, by: 'Krish' }), noRunIds) as Loose;
    expect(await same(() => permitsDb.syncOpenRunExists(new Date('2026-10-23T00:00:00Z'), 'burien'))).toBe(true);
    expect(await same(() => permitsDb.syncOpenRunExists(new Date('2026-10-23T00:00:00Z')))).toBe(true);
    expect(await same(() => permitsDb.syncOpenRunExists(new Date('2026-10-24T00:00:00Z')))).toBe(false);
    await same(() => permitsDb.syncFinishRun(started._id, { ok: true, finishedAt: t0, pages: 2, seen: 9, leads: 4, added: 1, updated: 2, detailErrors: 0, unsortedTypes: [{ type: 'Misc', count: 3 }], latestIssuedOn: '2026-10-22' }), noRunIds);
    const second = await same(() => permitsDb.syncStartRun({ source: 'burien', kind: 'manual', since: '2026-09-23', startedAt: new Date('2026-10-23T10:00:00Z') }), noRunIds) as Loose;
    await same(() => permitsDb.syncFailRun(second._id, 'boom', t0), noRunIds);
    expect(await same(() => permitsDb.syncFailRun('0'.repeat(24), 'x', t0))).toBeNull();
    await same(() => permitsDb.syncStartRun({ source: 'burien', kind: 'daily', since: '2026-09-24', startedAt: new Date('2026-10-23T11:00:00Z') }), noRunIds);
    expect(await same(() => permitsDb.syncCloseOpenRuns(t0, 'restart'))).toBe(1);
    expect(await same(() => permitsDb.syncHasBackfillRun('burien'))).toBe(true);
    expect(await same(() => permitsDb.syncHasBackfillRun('nowhere'))).toBe(false);
    await same(() => permitsDb.syncLastRun('burien'), noRunIds);
    await same(() => permitsDb.syncLastRun('burien', true), noRunIds);
    await same(() => permitsDb.syncFirstBackfillRun('king_county'), noRunIds);
    expect(await same(() => permitsDb.syncLastRun('nowhere'))).toBeNull();
  });
  it('syncs lambda\'s "is a pull running"', async () => {
    await permitsDb.syncStartRun({ source: 'whatcom', kind: 'daily', since: '2026-09-23', startedAt: new Date('2026-11-08T16:50:00Z') });
    const check = (on: 'mongo' | 'postgres') => t.on(on, () => permitSyncOnLambda({ sourceIds: () => [] }, () => new Date('2026-11-08T17:00:00Z')).isRunning());
    expect(await check('mongo')).toBe(true);
    // (the run above went to MongoDB only; Postgres has none that recent)
    expect(await check('postgres')).toBe(false);
    await t.resync();
  });
  it('saves checks, updates them in place, and never writes a month-so-far over a report', async () => {
    const fields = (method: string, extra: Loose = {}) => ({ source: 'burien', month: '2026-10', method, checkedAt: new Date('2026-10-23T09:00:00Z'), inReport: 3, matched: 3, missingFromApp: ['A'], ok: true, error: '', ...extra });
    await same(() => permitsDb.syncSaveCheck('burien', '2026-10', fields('search', { inSearch: 3 }), { keepReport: true }));
    await same(() => permitsDb.syncSaveCheck('burien', '2026-10', fields('search', { inSearch: 4, matched: 2, ok: false }), { keepReport: true }));
    expect(await same(() => permitsDb.syncReportCheckedMonths('burien'))).toEqual([]);
    await same(() => permitsDb.syncSaveCheck('burien', '2026-10', fields('report', { filled: 2, addedFromReport: ['Z'] })));
    await same(() => permitsDb.syncSaveCheck('burien', '2026-10', fields('search', { inSearch: 9 }), { keepReport: true }));
    expect(await same(() => permitsDb.syncReportCheckedMonths('burien'))).toEqual(['2026-10']);
    await same(() => permitsDb.syncSaveCheck('burien', '2026-11', { ...fields('report'), month: '2026-11', ok: false, error: 'down' }));
  });
});

describe('the registry cache', () => {
  it('saves records, names, not-found marks, and answers the lookups', async () => {
    clock = new Date('2026-10-25T12:00:00Z');
    const reg = contractors();
    const first = await same(() => reg.profile('vnconcl900aa')) as Loose;
    expect(first.found).toBe(true);
    await same(() => reg.profile('NOSUCH123XX'));
    const month = new Date('2026-09-01T00:00:00Z');
    const bySet = (v: unknown) => [...(v as string[])].sort();
    await same(() => permitsDb.registryKnownLicenses(['VNCONCL900AA', 'NOSUCH123XX', 'ABCHOHL123AB'], month), bySet);
    await same(() => permitsDb.registryKnownNames(['V N CONSTRUCTION LLC', 'ABC HOMES LLC'], month), bySet);
    await same(() => permitsDb.registrySavedContractor('VNCONCL900AA'), noRunIds);
    expect(await same(() => permitsDb.registrySavedContractor('NOSUCH123XX'))).toBeNull();
    await same(() => namesForLicense('VNCONCL900AA'), bySet);
    await same(() => permitsDb.registryNamedLicenses(['V N CONSTRUCTION LLC', 'NOPE']), v => (v as Loose[]).map(n => `${n.name}=${n.license}`));
    await same(() => permitsDb.registryContractorsByLicense(['VNCONCL900AA', 'NOSUCH123XX', 'ABCHOHL123AB']), v => noRunIds((v as Loose[]).sort((a, b) => a.license.localeCompare(b.license))));
    const lookup = await same(async () => {
      const find = await registryLookup([{ kind: 'contractor', company: 'V N Construction LLC' }, { kind: 'contractor', license: 'ABCHOHL123AB' }]);
      return [find({ kind: 'contractor', company: 'V N Construction LLC' }), find({ kind: 'contractor', license: 'ABCHOHL123AB' })];
    }) as Loose[];
    expect(lookup[0]).toMatchObject({ matchedBy: 'name', phone: '2536321912' });
  });
});
