import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Customer from '../models/Customer.ts';
import User from '../models/User.ts';
import Schedule from '../models/Schedule.ts';
import createCustomerResourcesRouter from './customerResources';

let mongo: MongoMemoryReplSet;
const me = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId(), source = new mongoose.Types.ObjectId(), destination = new mongoose.Types.ObjectId();
const actor = { id: String(me), permissions: ['add_visits', 'edit_own_visits', 'delete_own_visits'], assignedLocations: ['Seattle'] };
const app = express(); app.use(express.json());
const emit = vi.fn(); app.set('io', { emit });
app.use('/api/customers', createCustomerResourcesRouter({
  authenticate: (req, _res, next) => { const user = JSON.parse(String(req.headers['x-user'] || JSON.stringify(actor))); Object.assign(req, { user, userId: user.id, authType: 'admin' }); next(); },
  requirePermission: key => (req, res, next) => (req as any).user.permissions.includes(key) ? next() : void res.sendStatus(403),
  requireAnyPermission: (...keys) => (req, res, next) => keys.some(key => (req as any).user.permissions.includes(key)) ? next() : void res.sendStatus(403),
  getPerformerInfo: async req => ({ id: req.userId!, name: 'Test Rep' }), getNowLocalISO: () => '2026-10-31T10:00:00.000',
  processBase64Images: async images => images || [], emitScheduleUpdate: emit
}));
const doc = (id = source) => Customer.findById(id).lean() as Promise<any>;
const add = (notes: string, over = {}) => request(app).post(`/api/customers/${source}/resources`).send({ resourceType: 'Same type', date: '2026-10-31', notes, ...over });
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri());
  await Promise.all([Customer.createCollection(), User.createCollection(), Schedule.createCollection()]);
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await mongoose.connection.db!.command({ collMod: 'customers', validator: {} });
  await Promise.all([Customer.deleteMany({}), User.deleteMany({}), Schedule.deleteMany({})]); emit.mockClear();
  await User.collection.insertMany([{ _id: me, username: 'rep', assignedLocations: ['Seattle'] }, { _id: other, username: 'other', assignedLocations: ['Spokane'] }]);
  await Customer.create([{ _id: source, company: 'Source', contactName: 'Pat', email: 'source@example.invalid' }, { _id: destination, company: 'Destination', contactName: 'Lee', email: 'destination@example.invalid' }]);
});
describe('resource identity and history', () => {
  it('derives uploader from the actor and protects it, IDs and creation metadata on edit', async () => {
    const created = await add('One', { uploadedBy: String(other), visitId: String(other), createdAt: 'bad' }).expect(201);
    expect(created.body.resource.uploadedBy).toBe(String(me));
    expect(created.body.visit.resourceId).toBe(created.body.resource._id);
    const id = created.body.resource._id;
    await request(app).put(`/api/customers/${source}/resources/${id}`).send({ uploadedBy: String(other), visitId: String(other), createdAt: 'changed', _id: other, notes: 'Edited' }).expect(200);
    const stored = (await doc()).resources[0];
    expect(String(stored._id)).toBe(id); expect(stored.uploadedBy).toBe(String(me));
    expect(String(stored.visitId)).toBe(created.body.visit._id); expect(stored.createdAt).toBe('2026-10-31T10:00:00.000');
  });
  it('editing and deleting a repeated type affects exactly the linked visit and calendar', async () => {
    const first = (await add('First').expect(201)).body, second = (await add('Second').expect(201)).body;
    await request(app).put(`/api/customers/${source}/resources/${second.resource._id}`).send({ notes: 'Second edited' }).expect(200);
    const after = await doc();
    expect(after.visits.find((v: any) => String(v._id) === first.visit._id).notes).toBe('First');
    expect(after.visits.find((v: any) => String(v._id) === second.visit._id).notes).toBe('Second edited');
    await request(app).delete(`/api/customers/${source}/resources/${second.resource._id}`).expect(200);
    expect((await doc()).visits.map((v: any) => String(v._id))).toEqual([first.visit._id]);
    expect(await Schedule.countDocuments({ linkedVisitId: first.visit._id })).toBe(1);
    expect(await Schedule.countDocuments({ linkedVisitId: second.visit._id })).toBe(0);
  });
  it('moves both records and calendar customer references while preserving their IDs', async () => {
    const created = (await add('Moved').expect(201)).body;
    await request(app).put(`/api/customers/${destination}/resources/${created.resource._id}`).send({ notes: 'At destination' }).expect(200);
    expect((await doc()).resources).toHaveLength(0); expect((await doc()).visits).toHaveLength(0);
    const to = await doc(destination);
    expect(String(to.resources[0]._id)).toBe(created.resource._id); expect(to.resources[0].customer).toBe('Destination');
    expect(String(to.visits[0]._id)).toBe(created.visit._id); expect(to.visits[0].notes).toBe('At destination');
    expect(String((await Schedule.findOne({ linkedVisitId: created.visit._id }))!.customerId)).toBe(String(destination));
  });
  it('rolls back source, destination, visit and calendar when the destination rejects the move', async () => {
    const created = (await add('Rollback').expect(201)).body;
    await mongoose.connection.db!.command({ collMod: 'customers', validator: { $nor: [{ _id: destination, 'resources._id': new mongoose.Types.ObjectId(created.resource._id) }] } });
    emit.mockClear();
    await request(app).put(`/api/customers/${destination}/resources/${created.resource._id}`).send({ notes: 'Must not commit' }).expect(500);
    expect((await doc()).resources).toHaveLength(1); expect((await doc()).visits).toHaveLength(1);
    expect((await doc(destination)).resources).toHaveLength(0);
    expect(String((await Schedule.findOne({ linkedVisitId: created.visit._id }))!.customerId)).toBe(String(source));
    expect(emit).not.toHaveBeenCalled();
  });
  it('moves a placement date together with its calendar entry', async () => {
    const created = (await add('New day').expect(201)).body;
    await request(app).put(`/api/customers/${source}/resources/${created.resource._id}`).send({ date: '2026-11-02' }).expect(200);
    expect((await doc()).visits[0].date).toBe('2026-11-02');
    expect((await Schedule.findOne({ linkedVisitId: created.visit._id }))!.startTime.startsWith('2026-11-02T')).toBe(true);
  });
  it('refuses changing a resource belonging to somebody else', async () => {
    const created = (await add('Mine').expect(201)).body;
    const headers = { 'x-user': JSON.stringify({ ...actor, id: String(other) }) };
    await request(app).put(`/api/customers/${source}/resources/${created.resource._id}`).set(headers).send({ notes: 'Forbidden' }).expect(403);
    await request(app).delete(`/api/customers/${source}/resources/${created.resource._id}`).set(headers).expect(403);
    expect((await doc()).resources[0].notes).toBe('Mine');
  });
});
describe('legacy history', () => {
  const legacy = async (ambiguous = false) => {
    const rid = new mongoose.Types.ObjectId();
    await Customer.updateOne({ _id: source }, { $push: { resources: { _id: rid, title: 'Legacy', date: '2026-10-31', uploadedBy: String(me), notes: 'Original' }, visits: { $each: Array.from({ length: ambiguous ? 2 : 1 }, () => ({ _id: new mongoose.Types.ObjectId(), purpose: 'Resource Placement: Legacy', date: '2026-10-31', createdBy: String(me), notes: 'Original' })) } } });
    return rid;
  };
  it('links a uniquely identifiable old placement as it is edited', async () => {
    const rid = await legacy();
    await request(app).put(`/api/customers/${source}/resources/${rid}`).send({ notes: 'Updated' }).expect(200);
    const c = await doc(); expect(String(c.resources[0].visitId)).toBe(String(c.visits[0]._id));
    expect(String(c.visits[0].resourceId)).toBe(String(rid)); expect(c.visits[0].notes).toBe('Updated');
  });
  it('preserves ambiguous old history instead of changing the first matching title', async () => {
    const rid = await legacy(true);
    await request(app).delete(`/api/customers/${source}/resources/${rid}`).expect(409);
    await request(app).put(`/api/customers/${source}/resources/${rid}`).send({ notes: 'Do not guess' }).expect(409);
    const c = await doc(); expect(c.resources).toHaveLength(1); expect(c.visits).toHaveLength(2); expect(c.resources[0].notes).toBe('Original');
  });
});
