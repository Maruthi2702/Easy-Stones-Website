import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createScheduleRouter from './schedule.js';
import Schedule from '../models/Schedule.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';

let repl, app;
const owner = new mongoose.Types.ObjectId();
const other = new mongoose.Types.ObjectId();
const customer = new mongoose.Types.ObjectId();
const emit = vi.fn();
const staff = { id: String(owner), type: 'staff', permissions: ['create_route_plan', 'edit_route_plan'] };
const as = (user = staff) => ({ 'x-test-user': JSON.stringify(user) });
const stop = (over = {}) => ({ userId: owner, customerId: customer, startTime: '2026-10-24T09:00:00.000', source: 'route_planner', ...over });
const replacement = (over = {}) => ({ date: '2026-10-24', replace: true, items: [stop({ startTime: '2026-10-24T10:00:00.000' })], ...over });
const replace = (body = replacement(), user = staff) => request(app).post('/api/schedule/bulk').set(as(user)).send(body);
const subscription = (user = staff) => request(app).get('/api/calendar/subscription').set(as(user));

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(repl.getUri());
  await Promise.all([Schedule.createCollection(), User.createCollection(), Customer.createCollection()]);
  app = express(); app.use(express.json());
  app.use('/api', createScheduleRouter({
    jwtSecret: 'isolated-calendar-test-secret', emitScheduleUpdate: emit,
    authenticate: (req, res, next) => {
      if (!req.headers['x-test-user']) return res.sendStatus(401);
      req.user = JSON.parse(req.headers['x-test-user']);
      if (req.user.type !== 'customer') req.userId = req.user.id;
      next();
    },
    requirePermission: permission => (req, res, next) => req.user.permissions.includes(permission) ? next() : res.sendStatus(403)
  }));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });
beforeEach(async () => {
  await Promise.all([Schedule.deleteMany({}), User.deleteMany({}), Customer.deleteMany({})]);
  await User.collection.insertMany([{ _id: owner, username: 'owner', isActive: true }, { _id: other, username: 'other', isActive: true }]);
  await Customer.collection.insertOne({ _id: customer, contactName: 'Pat', company: 'Test Company' });
  emit.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('private calendar subscriptions', () => {
  it('refuses the old ID-only URL and invalid tokens', async () => {
    await Schedule.create(stop({ notes: 'Private notes' }));
    await request(app).get(`/api/calendar/feed/${owner}.ics`).expect(404);
    await request(app).get(`/api/calendar/feed/${owner}.ics?token=invalid`).expect(404);
    await request(app).get('/api/calendar/subscription').expect(401);
    await subscription({ id: String(customer), type: 'customer', permissions: [] }).expect(403);
  });
  it('issues stable links and lets calendar clients read without session cookies', async () => {
    await Schedule.create(stop({ notes: 'Private notes' }));
    const links = await Promise.all([subscription(), subscription(), subscription()]);
    expect(new Set(links.map(res => res.body.path)).size).toBe(1);
    const res = await request(app).get(links[0].body.path).expect(200);
    expect(res.text).toContain('Private notes');
    expect(res.text).toContain('Test Company');
    expect(await User.findById(owner).lean()).not.toHaveProperty('calendarFeedKey');
    const another = await subscription({ ...staff, id: String(other) });
    await request(app).get(another.body.path.replace(String(other), String(owner))).expect(404);
  });
  it('rotating the link revokes the previous credential immediately', async () => {
    const old = (await subscription()).body.path;
    await request(app).post('/api/calendar/subscription/rotate').expect(401);
    const rotated = await request(app).post('/api/calendar/subscription/rotate').set(as()).expect(200);
    expect(rotated.body.path).not.toBe(old);
    await request(app).get(old).expect(404);
    await request(app).get(rotated.body.path).expect(200);
    expect((await subscription()).body.path).toBe(rotated.body.path);
  });
  it('disabled and temporary-password accounts cannot serve a feed', async () => {
    const path = (await subscription()).body.path;
    await User.updateOne({ _id: owner }, { $set: { isActive: false } });
    await request(app).get(path).expect(404);
    await User.updateOne({ _id: owner }, { $set: { isActive: true, mustChangePassword: true } });
    await request(app).get(path).expect(404);
    await User.deleteOne({ _id: owner });
    await request(app).get(path).expect(404);
  });
});

describe('atomic route replacement', () => {
  it('invalid stops leave the previous route intact and emit no update', async () => {
    const old = await Schedule.create(stop());
    await replace(replacement({ items: [stop({ activityType: 'invalid' })] })).expect(400);
    expect(await Schedule.findById(old._id)).not.toBeNull();
    expect(await Schedule.countDocuments()).toBe(1);
    expect(emit).not.toHaveBeenCalled();
  });
  it('rolls back both deletion and partial inserts when a database write fails', async () => {
    const old = await Schedule.create(stop());
    const insert = Schedule.insertMany.bind(Schedule);
    vi.spyOn(Schedule, 'insertMany').mockImplementationOnce(async (documents, options) => {
      await insert([documents[0]], options);
      throw new Error('Simulated database write failure');
    });
    await replace().expect(500);
    expect(await Schedule.findById(old._id)).not.toBeNull();
    expect(await Schedule.countDocuments()).toBe(1);
    expect(emit).not.toHaveBeenCalled();
  });
  it('commits the new route while preserving manual stops and other users', async () => {
    const old = await Schedule.create(stop());
    const manual = await Schedule.create(stop({ source: 'manual' }));
    const otherUser = await Schedule.create(stop({ userId: other }));
    const res = await replace().expect(201);
    expect(res.body.replaced).toBe(1);
    expect(res.body.stops).toHaveLength(1);
    expect(await Schedule.findById(old._id)).toBeNull();
    expect(await Schedule.findById(manual._id)).not.toBeNull();
    expect(await Schedule.findById(otherUser._id)).not.toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('rejects replacements without edit permission, a date, or matching stop dates', async () => {
    const old = await Schedule.create(stop());
    await replace(replacement(), { ...staff, permissions: ['create_route_plan'] }).expect(403);
    await replace(replacement({ date: '' })).expect(400);
    await replace(replacement({ date: '2026-10-25' })).expect(400);
    expect(await Schedule.findById(old._id)).not.toBeNull();
  });
  it('also commits new routes without deleting existing entries', async () => {
    await Schedule.create(stop());
    await replace(replacement({ replace: false })).expect(201);
    expect(await Schedule.countDocuments()).toBe(2);
  });
});
