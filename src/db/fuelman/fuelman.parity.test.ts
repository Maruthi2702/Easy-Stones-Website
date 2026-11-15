/**
 * Fuel Man, through the real router: each request run on MongoDB, then on Postgres, must answer the same
 * and leave the same records behind (`t.differences()` is the copy's own check of every table, so the copy's
 * row builders are the spec for what Postgres writes). Users and branches stay on MongoDB (they move last).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import createFuelManRouter from '../../fuelman/router.ts';
import { ALL_FUEL_MAN_PERMISSIONS, FUEL_MAN as P } from '../../fuelman/permissions.ts';
import { fixtureReport } from '../../fuelman/testing/fixtures.ts';
import type { ParsedReport, ReportDetail } from '../../fuelman/types.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 180000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new record's id is made by the layer: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const FINANCE = { id: 'finance', username: 'finance', permissions: ALL_FUEL_MAN_PERMISSIONS, assignedLocations: ['*'] };
const SEATTLE_READER = { id: 'sea', username: 'sea', permissions: [P.VIEW, P.EXPORT], assignedLocations: ['Seattle'] };
const driverId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId();
const sea = 'user:' + driverId, spo = 'user:' + otherId;

let t: WriteParity;
let app: express.Express;
let clock = Date.parse('2026-11-10T17:30:00.000Z');

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await db.collection('roles').insertOne({ name: 'driver', permissions: ['delivery_driver_view'] });
    await db.collection('users').insertMany([
      { _id: driverId, username: 'driver1', displayName: 'Driver Alpha', role: 'driver', assignedLocations: ['Seattle'] },
      { _id: otherId, username: 'driver2', displayName: 'Driver Beta', role: 'driver', assignedLocations: ['Spokane'] }
    ]);
  }, 'DB_FUELMAN');
  app = express();
  app.use(express.json());
  app.use('/api/accounting/fuel-man', createFuelManRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-user']); next(); },
    parsePdf: async buffer => JSON.parse(buffer.toString()) as ParsedReport
  }));
}, 240000);
afterAll(async () => { await t?.close(); });

/** Each call runs a minute later, so lists never tie on a time. */
async function same(who: Loose, send: (path: (p: string) => string, a: typeof request) => request.Test, expected?: number) {
  ids.made.length = 0;
  clock += 60000;
  const ask = async () => { ids.used = 0; const r = await send(p => '/api/accounting/fuel-man' + p, request).set('x-user', JSON.stringify(who)); 
    // Files compare byte for byte; JSON compares as data (Postgres' jsonb orders an object's keys its own way).
    const file = Buffer.isBuffer(r.body) ? r.body.toString('hex') : undefined;
    return { status: r.status, body: file === undefined ? r.body : null, file }; };
  const { mongo, postgres } = await t.both(ask, new Date(clock));
  expect(postgres.status, JSON.stringify(postgres.body)).toBe(mongo.status);
  if (expected) expect(mongo.status, JSON.stringify(mongo.body)).toBe(expected);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  expect(postgres.file).toEqual(mongo.file);
  expect(await t.differences()).toEqual([]);
  return mongo;
}
const get = (path: string, who: Loose = FINANCE, status = 200) => same(who, (p, r) => r(app).get(p(path)).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, res.headers['content-type']?.includes('json') ? JSON.parse(Buffer.concat(chunks).toString()) : Buffer.concat(chunks))); }), status);
const post = (path: string, body: Loose, who: Loose = FINANCE, status = 200) => same(who, (p, r) => r(app).post(p(path)).send(body), status);
const upload = async (source: ParsedReport, marker = '') => (await same(FINANCE, (p, r) => r(app).post(p('/reports')).attach('file', Buffer.from(JSON.stringify({ ...source, marker })), 'report.pdf'))).body.id as string;
const detail = async (id: string) => (await get(`/reports/${id}`)).body as ReportDetail;
const env = (r: ReportDetail) => ({ version: r.version, token: r.review.token });
const item = (r: ReportDetail, externalId: string, location = 'Seattle', driverKey = sea, from = r.start) =>
  ({ externalId, driverKey, from, allocations: [{ location, percent: '100' }] });
const mapping = (r: ReportDetail, externalId: string, location = 'Seattle', driverKey = sea, from = r.start) =>
  ({ ...env(r), ...item(r, externalId, location, driverKey, from), note: 'Verified' });
const publishBody = async (id: string, over: Loose = {}) => ({ ...env(await detail(id)), note: 'Reviewed and approved', ...over });

describe('Fuel Man on both databases', () => {
  let july: string, august: string, september: string, october: string;

  it('imports a statement (and refuses the same file twice), lists it, reads its PDF and lines', async () => {
    july = await upload(fixtureReport('2026-07', ['A', 'B']));
    const again = await same(FINANCE, (p, r) => r(app).post(p('/reports')).attach('file', Buffer.from(JSON.stringify({ ...fixtureReport('2026-07', ['A', 'B']), marker: '' })), 'x.pdf'), 200);
    expect(again.body).toMatchObject({ duplicate: true, id: july });
    await get('/reports'); await get('/reports?page=1&limit=25');
    await get(`/reports/${july}/source`); await get(`/reports/${july}/lines?q=Truck&category=fuel`); await get(`/reports/${july}/lines?externalId=B&unknown=true`);
    await get('/revision'); await get('/metadata');
    await get(`/reports/${july}/history`); 
  });

  it('saves a match, a batch and a classification; refuses a stale or bad one', async () => {
    let r = await detail(july);
    await post(`/reports/${july}/assignments`, mapping(r, 'A'));
    await post(`/reports/${july}/assignments`, mapping(r, 'A'), FINANCE, 409); // stale: the version moved
    r = await detail(july);
    await post(`/reports/${july}/assignments`, { ...mapping(r, 'B'), allocations: [{ location: 'Seattle', percent: '40' }] }, FINANCE, 400);
    await post(`/reports/${july}/assignments/batch`, { ...env(r), note: 'batch', assignments: [{ ...item(r, 'B', 'Seattle', spo), allocations: [{ location: 'Seattle', percent: '60.5' }, { location: 'Spokane', percent: '39.5' }] }] });
    r = await detail(july);
    await post(`/reports/${july}/classifications`, { ...env(r), rows: [{ index: 0, category: 'supplies', note: 'recheck' }] });
    expect((await detail(july)).review.ready).toBe(true);
    await get(`/reports/${july}/lines?unknown=true`); await get(`/reports/${july}/history`);
  });

  it('publishes (twice is fine), shows branches only their share, and builds the P&L and its CSV', async () => {
    const body = await publishBody(july);
    await post(`/reports/${july}/publish`, body);
    await post(`/reports/${july}/publish`, body); // already posted: answers duplicate
    await get('/reports'); await get(`/reports/${july}`); await get('/pnl?month=2026-07');
    await get('/pnl?month=2026-07&format=csv'); await get('/pnl?month=2026-07&location=Seattle');
    await get('/reports', SEATTLE_READER); await get(`/reports/${july}`, SEATTLE_READER); await get(`/reports/${july}/lines`, SEATTLE_READER);
    await get('/pnl?month=2026-07', SEATTLE_READER); await get(`/reports/${july}/source`, SEATTLE_READER, 403);
  });

  it('carries a later match back when an earlier month is approved, and saves it then', async () => {
    september = await upload(fixtureReport('2026-09', ['A']));
    await post(`/reports/${september}/assignments`, mapping(await detail(september), 'A'));
    august = await upload(fixtureReport('2026-08', ['A', 'B']));
    await get(`/reports/${august}`);
    await post(`/reports/${august}/publish`, await publishBody(august));
    await get(`/reports/${august}/history`); await get(`/reports/${september}`); await get('/pnl?month=2026-08');
  });

  it('asks for a reason for a missing driver, ends their match on retiring, and changes it again', async () => {
    october = await upload(fixtureReport('2026-10', ['NEW']));
    await post(`/reports/${october}/assignments`, mapping(await detail(october), 'NEW', 'Seattle', spo));
    let r = await detail(october);
    expect(r.review.missing.length).toBeGreaterThan(0);
    await post(`/reports/${october}/missing`, { ...env(r), externalId: 'A', reason: 'identifier_changed', replacementId: 'NEW', note: 'new id' }, FINANCE, 400);
    await post(`/reports/${october}/missing`, { ...env(r), externalId: 'A', reason: 'retired', note: 'left', effectiveDate: '2026-10-15' });
    r = await detail(october);
    await post(`/reports/${october}/missing`, { ...env(r), externalId: 'A', reason: 'no_activity', note: 'changed my mind' });
    await get(`/reports/${october}`); await get(`/reports/${october}/history`);
  });

  it('replaces a correction, reverses, closes and reopens a month', async () => {
    const correction = await upload(fixtureReport('2026-07', ['A', 'B'], 100), 'correction');
    await post(`/reports/${correction}/assignments`, mapping(await detail(correction), 'A'));
    await post(`/reports/${correction}/assignments`, mapping(await detail(correction), 'B', 'Seattle', spo));
    await post(`/reports/${correction}/publish`, await publishBody(correction), FINANCE, 409);
    await post(`/reports/${correction}/publish`, await publishBody(correction, { replaceReportId: july }));
    await get('/pnl?month=2026-07'); await get(`/reports/${july}`); await get('/reports');
    await post(`/reports/${correction}/period`, { closed: true, note: 'month end' });
    await post(`/reports/${correction}/reverse`, { version: (await detail(correction)).version, note: 'oops' }, FINANCE, 409); // closed
    await post(`/reports/${correction}/period`, { closed: false, note: 'reopen' });
    await post(`/reports/${correction}/reverse`, { version: (await detail(correction)).version, note: 'reversing' });
    await get('/pnl?month=2026-07'); await get(`/reports/${correction}`); await get(`/reports/${correction}/history?limit=25&page=1`);
    await post(`/reports/${july}/publish`, await publishBody(july, { replaceReportId: undefined }), FINANCE, 200); // restores the superseded one
    await get('/pnl?month=2026-07'); await get('/reports'); await get('/revision');
  });
});
