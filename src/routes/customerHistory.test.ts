import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Customer from '../models/Customer.ts';
import User from '../models/User.ts';
import createCustomerHistoryRouter, { customerHistoryResponse } from './customerHistory';

const me = new mongoose.Types.ObjectId(), colleague = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
const ownVisit = new mongoose.Types.ObjectId(), otherVisit = new mongoose.Types.ObjectId(), otherResource = new mongoose.Types.ObjectId();
const cid = new mongoose.Types.ObjectId();
const profile = ['view_customers', 'view_customer_profile'];
let mongo: MongoMemoryServer;
const app = express();
app.use('/api/customers', createCustomerHistoryRouter({
  authenticate: (req, _res, next) => { Object.assign(req, { user: JSON.parse(String(req.headers['x-user'] || '{}')), userId: String(req.headers['x-id'] || me) }); next(); },
  requirePermission: key => (req, res, next) => ((req as any).user.permissions || []).includes(key) ? next() : void res.sendStatus(403)
}));
const headers = (permissions = profile, id = String(me), assignedLocations = ['Seattle']) => ({ 'x-user': JSON.stringify({ permissions, assignedLocations }), 'x-id': id });
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); }, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Customer.deleteMany({}), User.deleteMany({})]);
  await User.collection.insertMany([{ _id: me, username: 'viewer', assignedLocations: ['Seattle'] }, { _id: colleague, username: 'colleague', assignedLocations: ['Seattle'], isActive: false }, { _id: other, username: 'other', assignedLocations: ['Spokane'] }]);
  await Customer.collection.insertOne({ _id: cid, company: 'Example', contactName: 'Pat', email: 'pat@example.invalid', password: 'never return', visits: [
    { _id: ownVisit, createdBy: String(me), date: '2026-10-01' }, { _id: otherVisit, createdBy: String(other), date: '2026-10-31' }, { _id: new mongoose.Types.ObjectId(), createdBy: String(colleague), date: '2026-10-02' }
  ], resources: [{ _id: otherResource, uploadedBy: String(other), title: 'Other' }, { _id: new mongoose.Types.ObjectId(), uploadedBy: String(me), title: 'Mine' }] });
});
describe('history read scope', () => {
  it('own-only profile reads include only the viewer history and its last visit date', async () => {
    const { body } = await request(app).get('/api/customers/'+cid).set(headers()).expect(200);
    expect(body.visits.map((v: any) => v._id)).toEqual([String(ownVisit)]);
    expect(body.resources.map((r: any) => r.title)).toEqual(['Mine']);
    expect(body.lastVisitDate).toBe('2026-10-01'); expect(body.password).toBeUndefined();
  });
  it('branch reads include deactivated colleagues, but exclude the other branch', async () => {
    const { body } = await request(app).get('/api/customers/'+cid).set(headers([...profile, 'view_branch_visits'])).expect(200);
    expect(body.visits).toHaveLength(2); expect(body.lastVisitDate).toBe('2026-10-02');
  });
  it('all-visits permission preserves complete history', async () => {
    const { body } = await request(app).get('/api/customers/'+cid).set(headers([...profile, 'view_all_visits'])).expect(200);
    expect(body.visits).toHaveLength(3); expect(body.resources).toHaveLength(2);
  });
  it('individual reads cannot bypass own or branch scope', async () => {
    for (const permissions of [profile, [...profile, 'view_branch_visits']]) {
      await request(app).get(`/api/customers/${cid}/visits/${otherVisit}`).set(headers(permissions)).expect(404);
      await request(app).get(`/api/customers/${cid}/resources/${otherResource}`).set(headers(permissions)).expect(404);
    }
    await request(app).get(`/api/customers/${cid}/visits/${ownVisit}`).set(headers()).expect(200);
    await request(app).get(`/api/customers/${cid}/visits/${otherVisit}`).set(headers([...profile, 'view_all_visits'])).expect(200);
  });
  it('also scopes mutation response documents without changing their stored history', async () => {
    const record = await Customer.findById(cid);
    const body = await customerHistoryResponse({ userId: String(me), user: { permissions: [...profile, 'view_branch_visits'], assignedLocations: ['Seattle'] } } as any, record!);
    expect(body.visits).toHaveLength(2); expect(body.password).toBeUndefined();
    expect(record!.visits).toHaveLength(3);
  });
  it('keeps basic cards limited and rejects detail reads without full profile permission', async () => {
    const { body } = await request(app).get('/api/customers/'+cid).set(headers(['view_customers'])).expect(200);
    expect(body.visits).toBeUndefined(); expect(body.resources).toBeUndefined();
    await request(app).get(`/api/customers/${cid}/visits/${ownVisit}`).set(headers(['view_customers'])).expect(403);
  });
});
