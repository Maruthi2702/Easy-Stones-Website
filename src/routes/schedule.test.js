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

describe('saving one entry', () => {
  const body = (over = {}) => ({ customerId: String(customer), startTime: '2026-10-30T09:00:00.000', endTime: '2026-10-30T09:30:00.000', activityType: 'Call', notes: 'hi', ...over });
  const create = (over, user = staff) => request(app).post('/api/schedule').set(as(user)).send(body(over));

  it('saves a good entry and defaults the type', async () => {
    const res = await create({ activityType: undefined }).expect(201);
    expect(res.body.activityType).toBe('Visit');
    expect(res.body.endTime).toBe('2026-10-30T09:30:00.000');
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('refuses a bad type, times, notes and an unknown customer, and writes nothing', async () => {
    await create({ activityType: 'Lunch' }).expect(400);
    await create({ startTime: 'later' }).expect(400);
    await create({ endTime: '2026-10-30T09:00:00.000' }).expect(400);
    await create({ notes: 'x'.repeat(2001) }).expect(400);
    await create({ customerId: String(new mongoose.Types.ObjectId()) }).expect(400);
    expect(await Schedule.countDocuments()).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
  it('answers a repeated send with the entry it already saved', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    const first = await create({ _id }).expect(201);
    const again = await create({ _id }).expect(200);
    expect(again.body.alreadySaved).toBe(true);
    expect(again.body._id).toBe(first.body._id);
    expect(await Schedule.countDocuments()).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it('books once when the same send arrives twice at the same moment', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    const results = await Promise.all([create({ _id }), create({ _id })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 201]);
    expect(await Schedule.countDocuments()).toBe(1);
  });
  it('will not reuse another person\'s entry id', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    await create({ _id }, { ...staff, id: String(other) }).expect(201);
    await create({ _id }).expect(409);
    expect(await Schedule.countDocuments()).toBe(1);
  });
  it('an edit changes only what may change, and not whose or where it came from', async () => {
    const saved = await create().expect(201);
    const res = await request(app).put(`/api/schedule/${saved.body._id}`).set(as())
      .send({ notes: 'new', userId: String(other), source: 'route_planner' }).expect(200);
    expect(res.body.notes).toBe('new');
    const stored = await Schedule.findById(saved.body._id).lean();
    expect(String(stored.userId)).toBe(String(owner));
    expect(stored.source).toBe('manual');
  });
  it('an edit that puts the start after the stored end is refused', async () => {
    const saved = await create().expect(201);
    await request(app).put(`/api/schedule/${saved.body._id}`).set(as()).send({ startTime: '2026-10-30T10:00:00.000' }).expect(400);
    await request(app).put(`/api/schedule/${saved.body._id}`).set(as())
      .send({ startTime: '2026-10-30T10:00:00.000', endTime: '2026-10-30T10:30:00.000' }).expect(200);
  });
  it('cannot edit someone else\'s entry or a made-up id', async () => {
    const saved = await create().expect(201);
    await request(app).put(`/api/schedule/${saved.body._id}`).set(as({ ...staff, id: String(other) })).send({ notes: 'x' }).expect(404);
    await request(app).put('/api/schedule/not-an-id').set(as()).send({ notes: 'x' }).expect(404);
  });
  it('the route planner\'s one-stop add checks times and can be repeated', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    const item = { _id, customerId: String(customer), startTime: '2026-10-30T09:30:00.000', endTime: '2026-10-30T10:00:00.000', activityType: 'Visit' };
    await replace({ date: '2026-10-30', items: [{ ...item, endTime: '2026-10-30T09:00:00.000' }] }).expect(400);
    await replace({ date: '2026-10-30', items: [item] }).expect(201);
    const again = await replace({ date: '2026-10-30', items: [item] }).expect(200);
    expect(again.body.alreadySaved).toBe(true);
    expect(await Schedule.countDocuments()).toBe(1);
  });
});

describe('the calendar feed', () => {
  it('gives an entry with no end time 30 minutes, the length the planners assume', async () => {
    await Schedule.create(stop({ startTime: '2026-10-30T09:00:00.000', endTime: undefined }));
    const link = (await subscription()).body.path;
    const res = await request(app).get(link).expect(200);
    const start = res.text.match(/DTSTART[^:]*:(\d{8}T\d{6}Z)/)?.[1];
    const end = res.text.match(/DTEND[^:]*:(\d{8}T\d{6}Z)/)?.[1];
    expect(start && end).toBeTruthy();
    const ms = (t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(9, 11), +t.slice(11, 13));
    expect(ms(end) - ms(start)).toBe(30 * 60000);
  });
});
