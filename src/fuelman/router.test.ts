import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createRouter from './router';
import { ALL_FUEL_MAN_PERMISSIONS, FUEL_MAN as P } from './permissions';
import { FUEL_MODELS, FuelExpense, FuelReport, FuelSource, FuelPeriod, FuelProfile, FuelAssignment, FuelAudit } from './models';
import Location from '../models/Location.js';
import User from '../models/User.js';
import Role from '../models/Role.js';
import { fixtureReport } from './testing/fixtures';
import type { ParsedReport, ReportDetail } from './types';
let db: MongoMemoryReplSet, app: express.Express;
const user = { id: 'finance', username: 'finance', permissions: ALL_FUEL_MAN_PERMISSIONS, assignedLocations: ['*'] };
const driverId = new mongoose.Types.ObjectId(), otherId = new mongoose.Types.ObjectId();
const api = (method: 'get' | 'post', path: string, who = user) => request(app)[method]('/api/accounting/fuel-man' + path).set('x-user', JSON.stringify(who));
const upload = async (source = fixtureReport(), marker = '') => (await api('post', '/reports').attach('file', Buffer.from(JSON.stringify({ ...source, marker })), 'report.pdf').expect(201)).body.id as string;
const detail = async (id: string) => (await api('get', `/reports/${id}`).expect(200)).body as ReportDetail;
const envelope = (r: ReportDetail) => ({ version: r.version, token: r.review.token });
async function assign(id: string, externalId = 'A', location = 'Seattle', key = `user:${driverId}`, from = '') {
  const r = await detail(id);
  return api('post', `/reports/${id}/assignments`).send({ ...envelope(r), externalId, driverKey: key, profileName: '', profileKind: 'driver',
    from: from || r.start, allocations: [{ location, percent: '100' }], note: 'Verified driver and cost location' }).expect(200);
}
const publish = async (id: string, over: Record<string, unknown> = {}) => api('post', `/reports/${id}/publish`).send({ ...envelope(await detail(id)), note: 'Reviewed and approved', ...over });
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all([...FUEL_MODELS.map(m => m.init()), Location.init(), User.init(), Role.init()]);
  app = express(); app.use(express.json());
  app.use('/api/accounting/fuel-man', createRouter({ authenticate: (req, res, next) => {
    if (!req.headers['x-user']) { res.sendStatus(401); return; } req.user = JSON.parse(String(req.headers['x-user'])); next();
  }, parsePdf: async buffer => JSON.parse(buffer.toString()) as ParsedReport }));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  await Promise.all(FUEL_MODELS.map(m => m.collection.deleteMany({})));
  await Promise.all([Location.deleteMany({}), User.deleteMany({}), Role.deleteMany({})]);
  await Location.collection.insertMany([{ name: 'Seattle' }, { name: 'Spokane' }]);
  await Role.collection.insertOne({ name: 'driver', permissions: ['delivery_driver_view'] });
  await User.collection.insertMany([{ _id: driverId, username: 'driver1', displayName: 'Driver Alpha', role: 'driver', assignedLocations: ['Seattle'] }, { _id: otherId, username: 'driver2', displayName: 'Driver Beta', role: 'driver', assignedLocations: ['Spokane'] }]);
});
describe('Fuel Man import and review workflow', () => {
  it('requires independent permissions and company-wide access for source operations', async () => {
    await request(app).get('/api/accounting/fuel-man/reports').expect(401);
    await api('get', '/reports', { ...user, permissions: [] }).expect(403);
    await api('post', '/reports', { ...user, assignedLocations: ['Seattle'] }).attach('file', Buffer.from('private'), 'report.pdf').expect(403);
    const id = await upload();
    await api('post', `/reports/${id}/assignments`, { ...user, permissions: [P.VIEW] }).send({}).expect(403);
    expect((await api('get', '/metadata')).body.drivers).toHaveLength(2);
  });
  it('lists Users with any Driver profile role, excludes expense profiles and validates the selected user on save', async () => {
    const customId = new mongoose.Types.ObjectId(), officeId = new mongoose.Types.ObjectId();
    await Role.collection.insertOne({ name: 'custom_courier', displayName: 'Courier profile', permissions: ['delivery_driver_view'] });
    await Role.collection.insertOne({ name: 'office', permissions: ['view_delivery_schedule'] });
    await User.collection.insertMany([{ _id: customId, username: 'legacy.driver', role: 'custom_courier', location: 'Seattle', assignedLocations: [], isActive: false },
      { _id: officeId, username: 'office', displayName: 'Office User', role: 'office' }]);
    const profile = await FuelProfile.create({ name: 'Old expense profile', kind: 'driver', createdBy: { id: 'old', name: 'Old' } });
    const metadata = (await api('get', '/metadata')).body;
    expect(metadata.drivers).toHaveLength(3); expect(metadata.drivers.every((d: { kind: string }) => d.kind === 'user')).toBe(true);
    expect(metadata.drivers.find((d: { key: string }) => d.key === `user:${customId}`)).toMatchObject({ name: 'Legacy Driver', active: false, locations: ['Seattle'], homeLocation: 'Seattle' });
    expect(JSON.stringify(metadata.drivers)).not.toContain('password');
    const id = await upload(), r = await detail(id), body = { ...envelope(r), externalId: 'A', from: r.start, allocations: [{ location: 'Seattle', percent: '100' }], note: 'Verified user selection' };
    await api('post', `/reports/${id}/assignments`).send({ ...body, driverKey: `user:${officeId}` }).expect(400);
    await api('post', `/reports/${id}/assignments`).send({ ...body, driverKey: `profile:${profile._id}` }).expect(400);
    await api('post', `/reports/${id}/assignments`).send({ ...body, driverKey: `user:${customId}`, profileName: 'Spoofed name' }).expect(200);
    expect((await detail(id)).review.drivers[0]!.driverName).toBe('Legacy Driver');
    await User.collection.updateOne({ _id: customId }, { $set: { role: 'office' } });
    await api('post', `/reports/${id}/assignments`).send({ ...body, ...envelope(await detail(id)), driverKey: `user:${customId}` }).expect(400);
    expect(await FuelProfile.countDocuments()).toBe(1);
  });
  it('stores the private original, rejects duplicate files/re-exports and reuses mappings', async () => {
    const source = fixtureReport(), id = await upload(source);
    expect(await FuelSource.countDocuments()).toBe(1);
    const duplicate = await api('post', '/reports').attach('file', Buffer.from(JSON.stringify({ ...source, marker: 'other PDF bytes' })), 'export.pdf').expect(200);
    expect(duplicate.body).toMatchObject({ id, duplicate: true }); expect(await FuelReport.countDocuments()).toBe(1);
    expect((await detail(id)).review.ready).toBe(false); await assign(id);
    expect((await detail(id)).review.ready).toBe(true);
    const august = await upload(fixtureReport('2026-08')); expect((await detail(august)).review.ready).toBe(true);
    const pdf = await api('get', `/reports/${id}/source`).expect(200); expect(pdf.headers['content-type']).toContain('application/pdf');
  });
  it('saves a driver match once and reuses it across existing uploads, later months and gaps, prompting only for a new identity', async () => {
    const july = await upload(), august = await upload(fixtureReport('2026-08')), september = await upload(fixtureReport('2026-09'));
    const initial = await detail(july);
    await api('post', `/reports/${july}/assignments/batch`).send({ ...envelope(initial), note: 'One-time confirmed driver match', assignments: [{
      externalId: 'A', driverKey: `user:${driverId}`, from: initial.start, allocations: [{ location: 'Seattle', percent: '100' }],
    }] }).expect(200);
    const saved = await FuelAssignment.findOne().lean(); expect(saved!.to).toBe('');
    for (const id of [july, august, september]) {
      const r = await detail(id); expect(r.review.ready).toBe(true);
      expect(r.review.drivers[0]).toMatchObject({ driverKey: `user:${driverId}`, locations: ['Seattle'], newIdentity: false, issues: [] });
      expect(r.review.locations[0]!.totalCents).toBe(5250);
    }
    // Approving a later month's costs requires no second assignment, even
    // when the original matching report has not itself been approved.
    expect((await publish(august)).status).toBe(200);
    const future = await upload(fixtureReport('2027-03', ['A', 'NEW'])), review = (await detail(future)).review;
    expect(review.drivers.find(d => d.externalId === 'A')).toMatchObject({ driverKey: `user:${driverId}`, locations: ['Seattle'], newIdentity: false, issues: [] });
    expect(review.drivers.filter(d => !d.driverKey).map(d => d.externalId)).toEqual(['NEW']);
    expect(review.drivers.find(d => d.externalId === 'NEW')!.newIdentity).toBe(true);
    expect(await FuelAssignment.countDocuments()).toBe(1); expect(String((await FuelAssignment.findOne())!._id)).toBe(String(saved!._id));
  });
  it('saves single and batch assignments without notes and keeps actor history', async () => {
    const id = await upload(fixtureReport('2026-07', ['A', 'B'])); let r = await detail(id);
    const mapping = (externalId: string) => ({ externalId, driverKey: `user:${driverId}`, from: r.start, allocations: [{ location: 'Seattle', percent: '100' }] });
    await api('post', `/reports/${id}/assignments`).send({ ...envelope(r), ...mapping('A') }).expect(200);
    r = await detail(id);
    await api('post', `/reports/${id}/assignments/batch`).send({ ...envelope(r), assignments: [mapping('B')], note: '   ' }).expect(200);
    expect((await detail(id)).review.ready).toBe(true);
    const entries = await FuelAudit.find({ reportId: id, action: { $in: ['assignment', 'assignments'] } }).lean();
    expect(entries).toHaveLength(2); expect(entries.every(e => e.note === '' && e.actor.id === 'finance')).toBe(true);
    r = await detail(id);
    await api('post', `/reports/${id}/assignments`).send({ ...envelope(r), ...mapping('A'), note: 'x'.repeat(501) }).expect(400);
  });
  it('keeps unpublished expenses outside location P&L and publishes once under concurrent clicks', async () => {
    const id = await upload(); await assign(id);
    expect((await api('get', '/pnl?month=2026-07')).body.reportCount).toBe(0);
    const r = await detail(id), body = { ...envelope(r), note: 'Reviewed' };
    const responses = await Promise.all([api('post', `/reports/${id}/publish`).send(body), api('post', `/reports/${id}/publish`).send(body)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(await FuelExpense.countDocuments()).toBe(5);
    const pnl = (await api('get', '/pnl?month=2026-07').expect(200)).body;
    expect(pnl.totalCents).toBe(5250); expect(pnl.locations[0].amounts.adjustment).toBe(-100);
    await api('get', '/pnl?month=2026-07&format=csv', { ...user, permissions: [P.VIEW] }).expect(403);
    expect((await api('get', '/pnl?month=2026-07&format=csv')).text).toContain('"adjustment","-1.00"');
  });
  it('blocks stale reviews, bad allocations and overlapping concurrent mapping saves', async () => {
    const id = await upload(), r = await detail(id);
    const value = { ...envelope(r), externalId: 'A', driverKey: `user:${driverId}`, from: r.start, allocations: [{ location: 'Seattle', percent: '100' }], note: 'Assignment' };
    const results = await Promise.all([api('post', `/reports/${id}/assignments`).send(value), api('post', `/reports/${id}/assignments`).send(value)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    await api('post', `/reports/${id}/publish`).send({ ...envelope(r), note: 'Stale review' }).expect(409);
    await api('post', `/reports/${id}/assignments`).send({ ...value, ...envelope(await detail(id)), allocations: [{ location: 'Seattle', percent: '40' }] }).expect(400);
  });
  it('requires a period-specific reason for missing identities and retains no-activity expectations', async () => {
    const july = await upload(); await assign(july); await publish(july).then(r => expect(r.status).toBe(200));
    const august = await upload(fixtureReport('2026-08', ['B'])); await assign(august, 'B');
    let r = await detail(august); expect(r.review.missing[0]!.externalId).toBe('A');
    expect((await publish(august)).status).toBe(409);
    await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'investigating', note: 'Checking the source' }).expect(200);
    expect((await publish(august)).status).toBe(409);
    r = await detail(august); await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'no_activity', note: 'Confirmed no card use in August' }).expect(200);
    expect((await publish(august)).status).toBe(200);
    const september = await upload(fixtureReport('2026-09', ['B'])); expect((await detail(september)).review.missing[0]!.resolved).toBe(false);
    expect((await api('get', '/pnl?month=2026-08')).body.totalCents).toBe(5250);
  });
  it('requires a confirmed matching driver for ID changes, then stops future false missing alerts', async () => {
    const july = await upload(); await assign(july);
    const august = await upload(fixtureReport('2026-08', ['NEW'])); await assign(august, 'NEW', 'Seattle', `user:${otherId}`);
    let r = await detail(august);
    await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'identifier_changed', replacementId: 'NEW', note: 'New card identity' }).expect(400);
    await assign(august, 'NEW'); r = await detail(august);
    await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'identifier_changed', replacementId: 'NEW', note: 'Same driver, new report ID' }).expect(200);
    expect((await detail(august)).review.ready).toBe(true);
    const september = await upload(fixtureReport('2026-09', ['NEW'])); expect((await detail(september)).review.missing).toHaveLength(0);
  });
  it('replaces a corrected report instead of adding the same period twice, with explicit reversal authority', async () => {
    const id = await upload(); await assign(id); expect((await publish(id)).status).toBe(200);
    const correction = await upload(fixtureReport('2026-07', ['A'], 100));
    expect((await publish(correction)).status).toBe(409);
    expect((await publish(correction, { replaceReportId: id })).status).toBe(200);
    expect((await api('get', '/pnl?month=2026-07')).body.totalCents).toBe(5350);
    expect((await detail(id)).status).toBe('superseded');
    expect(await FuelExpense.countDocuments()).toBe(10);
    const previous = await detail(id);
    await api('post', `/reports/${id}/publish`, { ...user, permissions: [P.VIEW, P.APPROVE] }).send({ ...envelope(previous), note: 'Restore', replaceReportId: correction }).expect(403);
    expect((await publish(id, { replaceReportId: correction })).status).toBe(200);
    expect((await api('get', '/pnl?month=2026-07')).body.totalCents).toBe(5250);
    expect(await FuelExpense.countDocuments()).toBe(10);
  });
  it('protects closed periods and preserves the original facts on reversal', async () => {
    const id = await upload(); await assign(id); expect((await publish(id)).status).toBe(200);
    await api('post', `/reports/${id}/period`).send({ closed: true, note: 'Month reviewed and closed' }).expect(200);
    await api('post', `/reports/${id}/reverse`).send({ version: (await detail(id)).version, note: 'Correction requested' }).expect(409);
    await api('post', `/reports/${id}/period`).send({ closed: false, note: 'Authorized correction' }).expect(200);
    await api('post', `/reports/${id}/reverse`).send({ version: (await detail(id)).version, note: 'Reversal' }).expect(200);
    expect((await api('get', '/pnl?month=2026-07')).body.reportCount).toBe(0); expect(await FuelExpense.countDocuments()).toBe(5);
  });
  it('shows only a branch share and never discloses the original company PDF or full transaction amounts', async () => {
    const id = await upload(), r = await detail(id);
    await api('post', `/reports/${id}/assignments`).send({ ...envelope(r), externalId: 'A', driverKey: `user:${driverId}`, from: r.start,
      allocations: [{ location: 'Seattle', percent: '50' }, { location: 'Spokane', percent: '50' }], note: 'Approved cross-branch split' }).expect(200);
    expect((await publish(id)).status).toBe(200);
    const branch = { ...user, assignedLocations: ['Seattle'] };
    const own = (await api('get', `/reports/${id}`, branch).expect(200)).body;
    expect(own.totalCents).toBe(2625); expect(own.review.drivers[0].totalCents).toBe(2625); expect(own.canViewSource).toBe(false);
    expect(own.review.drivers[0].assignments).toEqual([]); expect(own.review.locations.map((l: { location: string }) => l.location)).toEqual(['Seattle']);
    const lines = (await api('get', `/reports/${id}/lines`, branch)).body.items;
    expect(lines[0].amountCents).toBe(2100); expect(lines[0].description).not.toContain('$42.00');
    await api('get', `/reports/${id}/source`, branch).expect(403); await api('get', `/reports/${id}/history`, branch).expect(403);
    expect((await api('get', '/pnl?month=2026-07', branch)).body.totalCents).toBe(2625);
    await api('get', '/pnl?month=2026-07&location=Spokane', branch).expect(403);
  });
  it('restores future roster expectations when a retirement reason is corrected', async () => {
    const july = await upload(); await assign(july);
    const august = await upload(fixtureReport('2026-08', ['B'])); await assign(august, 'B');
    let r = await detail(august);
    await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'retired', effectiveDate: '2026-08-01', note: 'Card believed retired' }).expect(200);
    const september = await upload(fixtureReport('2026-09', ['B'])); expect((await detail(september)).review.missing).toHaveLength(0);
    r = await detail(august);
    await api('post', `/reports/${august}/missing`).send({ ...envelope(r), externalId: 'A', reason: 'no_activity', note: 'Correction: driver remains active' }).expect(200);
    expect((await detail(september)).review.missing.map(m => m.externalId)).toEqual(['A']);
  });
  it('blocks unclassified purchases and rejects an approval token invalidated by another report', async () => {
    const source = fixtureReport(); source.lines[0]!.category = 'other';
    const id = await upload(source); await assign(id); expect((await publish(id)).status).toBe(409);
    let r = await detail(id);
    await api('post', `/reports/${id}/classifications`).send({ ...envelope(r), rows: [{ index: 0, category: 'fuel', note: 'Verified product on source' }] }).expect(200);
    r = await detail(id); expect(r.review.ready).toBe(true);
    const other = await upload(fixtureReport('2026-08')); await assign(other, 'A', 'Spokane', `user:${driverId}`, '2026-07-01');
    await api('post', `/reports/${id}/publish`).send({ ...envelope(r), note: 'Stale cross-report review' }).expect(409);
    expect(await FuelExpense.countDocuments()).toBe(0);
  });
  it('shows unassigned costs immediately and atomically sets up several drivers without posting expenses', async () => {
    const id = await upload(fixtureReport('2026-09', ['A', 'B'])), r = await detail(id);
    expect(r.review.drivers).toHaveLength(2);
    expect(r.review.unassigned).toMatchObject({ totalCents: 10500, driverCount: 2, lineCount: 10 });
    const assignments = r.review.drivers.map((d, i) => ({ externalId: d.externalId, driverKey: `user:${i ? otherId : driverId}`, from: d.suggestedFrom,
      allocations: [{ location: i ? 'Spokane' : 'Seattle', percent: '100' }] }));
    const payload = { ...envelope(r), note: 'Confirmed first-time driver locations', assignments };
    await api('post', `/reports/${id}/assignments/batch`, { ...user, permissions: [P.VIEW] }).send(payload).expect(403);
    await api('post', `/reports/${id}/assignments/batch`, { ...user, assignedLocations: ['Seattle'] }).send(payload).expect(403);
    await api('post', `/reports/${id}/assignments/batch`).send({ ...payload, assignments: [assignments[0], assignments[0]] }).expect(400);
    await api('post', `/reports/${id}/assignments/batch`).send({ ...payload, assignments: [assignments[0], { ...assignments[1], allocations: [{ location: 'Missing branch', percent: '100' }] }] }).expect(400);
    expect(await FuelProfile.countDocuments()).toBe(0); expect(await FuelAssignment.countDocuments()).toBe(0); expect((await detail(id)).version).toBe(r.version);
    await api('post', `/reports/${id}/assignments/batch`).send(payload).expect(200);
    const next = await detail(id); expect(next.review.ready).toBe(true); expect(next.review.unassigned.lineCount).toBe(0);
    expect(next.review.locations.map(l => [l.location, l.totalCents])).toEqual([['Seattle', 5250], ['Spokane', 5250]]);
    expect(next.version).toBe(r.version + 1); expect(await FuelProfile.countDocuments()).toBe(0); expect(await FuelExpense.countDocuments()).toBe(0);
    await api('post', `/reports/${id}/assignments/batch`).send(payload).expect(409); expect(await FuelProfile.countDocuments()).toBe(0);
    const october = await upload(fixtureReport('2026-10', ['A', 'B'])); expect((await detail(october)).review.ready).toBe(true);
  });
  it('requires existing driver users and acknowledges late statement dates without creating profiles', async () => {
    const source = fixtureReport('2026-09'); source.lines[0]!.date = '2026-08-20';
    const id = await upload(source), r = await detail(id), beforeUsers = await User.countDocuments();
    await api('post', `/reports/${id}/assignments`).send({ ...envelope(r), externalId: 'A', driverKey: '', profileName: 'Shared Fleet', profileKind: 'shared',
      from: '2026-08-01', allocations: [{ location: 'Seattle', percent: '100' }], note: 'Shared cost account' }).expect(400);
    await assign(id, 'A', 'Seattle', `user:${driverId}`, '2026-08-01');
    expect(await FuelProfile.countDocuments()).toBe(0);
    expect(await User.countDocuments()).toBe(beforeUsers);
    expect((await publish(id)).status).toBe(400); expect((await publish(id, { acknowledgePriorDates: true })).status).toBe(200);
    expect((await api('get', '/pnl?month=2026-09')).body.totalCents).toBe(5250); expect((await api('get', '/pnl?month=2026-08')).body.totalCents).toBe(0);
  });
});
