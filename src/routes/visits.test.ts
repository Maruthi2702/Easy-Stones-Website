import type { Loose } from '../types/records.ts';
// Add / edit visit and visit photos (src/routes/visits.ts) against a throwaway
// in-memory MongoDB: the visit types, no follow-up on a Quick note, a repeat of
// the same POST (same _id) adding nothing, PUT answering with the stored visit,
// and a photo coming back as a link.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createVisitsRouter } = await import('./visits.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: User } = await import('../models/User.ts');
const { default: VisitType } = await import('../models/VisitType.ts');
const { seedTypeLists } = await import('../services/seedTypeLists.ts');

let mongo;
let app;
let customerId: string;
let processBase64Image;

const STAFF = { _id: 'u1', permissions: ['add_visits', 'edit_own_visits'], assignedLocations: ['*'] };
const send = (method: string, url: string, body: Loose, user = STAFF) =>
  request(app)[method](url).set('x-test-user', JSON.stringify(user)).send(body);
const visitsNow = async () => (await Customer.findById(customerId).lean()).visits;
const base = (over: Loose = {}) => ({ date: '2026-10-20', purpose: 'Unscheduled in Person Sales Call', notes: 'hi', ...over });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  processBase64Image = vi.fn(async (s) => (s.startsWith('data:image/') ? 'https://cdn.example/x.webp' : s.startsWith('data:application/pdf') ? 'https://cdn.example/x.pdf' : s));
  app = express();
  app.use(express.json());
  app.set('io', { emit: () => {} });
  const has = (req: Loose, p: Loose) => (req.user.permissions || []).includes(p);
  app.use('/api/customers', createVisitsRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); req.userId = req.user._id; req.authType = 'admin'; next(); },
    requirePermission: (p: Loose) => (req: Loose, res: Loose, next: Loose) => (has(req, p) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps: Loose[]) => (req: Loose, res: Loose, next: Loose) => (ps.some((p) => has(req, p)) ? next() : res.status(403).json({})),
    processBase64Image,
    getPerformerInfo: async () => ({ id: 'u1', name: 'Rita' }),
    getNowLocalISO: () => '2026-10-23T09:00:00.000',
    emitScheduleUpdate: () => {}
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Customer.deleteMany({});
  // The visit types live in the database; start each test with the first-start list.
  await VisitType.deleteMany({});
  await seedTypeLists();
  customerId = String((await Customer.create({ contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com' }))._id);
  processBase64Image.mockClear();
});

describe('visit types come from the database', () => {
  it('refuses a hidden type for a new visit but keeps it on the visit that has it', async () => {
    await VisitType.create({ name: 'Trade Show', label: 'Trade show', order: 99, active: false });
    const url = `/api/customers/${customerId}/visits`;
    expect((await send('post', url, base({ purpose: 'Trade Show' }))).status).toBe(400);
    await Customer.updateOne({ _id: customerId }, { $push: { visits: { date: '2026-01-01', purpose: 'Trade Show', createdBy: 'u1' } } });
    const v = (await visitsNow())[0];
    expect((await send('put', `${url}/${v._id}`, { purpose: 'Trade Show', notes: 'x' })).status).toBe(200);
  });

  it('accepts a type a manager added, and follows the fields they chose', async () => {
    await VisitType.create({ name: 'Site Walk', label: 'Site walk', order: 99, fields: { notes: true, outcome: false, followUp: 'none' } });
    const res = await send('post', `/api/customers/${customerId}/visits`, base({ purpose: 'Site Walk', followUp: 'call', followUpDate: '2026-11-01' }));
    expect(res.status).toBe(201);
    expect(res.body.visit.followUp || '').toBe('');
  });
});

describe('POST /:customerId/visits', () => {
  it('saves a visit and answers 201 with it', async () => {
    const res = await send('post', `/api/customers/${customerId}/visits`, base());
    expect(res.status).toBe(201);
    expect(res.body.visit.purpose).toBe('Unscheduled in Person Sales Call');
    expect((await visitsNow())).toHaveLength(1);
  });

  it('refuses a visit type that is not in the list', async () => {
    const res = await send('post', `/api/customers/${customerId}/visits`, base({ purpose: 'Chat' }));
    expect(res.status).toBe(400);
    expect(await visitsNow()).toHaveLength(0);
  });

  it('stores no follow-up on a Quick note, whatever was sent', async () => {
    const res = await send('post', `/api/customers/${customerId}/visits`,
      base({ purpose: 'Quick Note', followUp: 'call back', followUpDate: '2026-11-01' }));
    expect(res.status).toBe(201);
    const [v] = await visitsNow();
    expect(v.followUp).toBe('');
    expect(v.followUpDate).toBe('');
  });

  it('keeps the follow-up on a type that has one', async () => {
    await send('post', `/api/customers/${customerId}/visits`, base({ followUp: 'call back', followUpDate: '2026-11-01' }));
    const [v] = await visitsNow();
    expect(v.followUp).toBe('call back');
    expect(v.followUpDate).toBe('2026-11-01');
  });

  it('a repeat with the same _id adds no second visit', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    const a = await send('post', `/api/customers/${customerId}/visits`, base({ _id }));
    const b = await send('post', `/api/customers/${customerId}/visits`, base({ _id }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.alreadySaved).toBe(true);
    expect(String(b.body.visit._id)).toBe(_id);
    expect(await visitsNow()).toHaveLength(1);
  });

  it('two racing tries with the same _id still save one', async () => {
    const _id = String(new mongoose.Types.ObjectId());
    const url = `/api/customers/${customerId}/visits`;
    const [a, b] = await Promise.all([send('post', url, base({ _id })), send('post', url, base({ _id }))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await visitsNow()).toHaveLength(1);
  });

  it('refuses an _id that is not an id, and a missing date', async () => {
    const url = `/api/customers/${customerId}/visits`;
    expect((await send('post', url, base({ _id: 'nope' }))).status).toBe(400);
    expect((await send('post', url, base({ date: '' }))).status).toBe(400);
  });

  it('404 for a customer that is not there', async () => {
    const res = await send('post', `/api/customers/${new mongoose.Types.ObjectId()}/visits`, base());
    expect(res.status).toBe(404);
  });

  it('needs the Add visits switch', async () => {
    const res = await send('post', `/api/customers/${customerId}/visits`, base(), { _id: 'u1', permissions: [] });
    expect(res.status).toBe(403);
  });

  it('turns raw photo data into links; links pass through', async () => {
    const res = await send('post', `/api/customers/${customerId}/visits`,
      base({ image: ['data:image/jpeg;base64,AAAA', 'https://cdn.example/old.webp'] }));
    expect(res.body.visit.image).toEqual(['https://cdn.example/x.webp', 'https://cdn.example/old.webp']);
  });
});

describe('PUT /:customerId/visits/:visitId', () => {
  const add = async (over: Loose) => (await send('post', `/api/customers/${customerId}/visits`, base(over))).body.visit;

  it('saves the change and answers with the stored visit', async () => {
    const v = await add();
    const res = await send('put', `/api/customers/${customerId}/visits/${v._id}`, { notes: 'changed', image: ['data:image/png;base64,AAAA'] });
    expect(res.status).toBe(200);
    expect(res.body.visit.notes).toBe('changed');
    expect(res.body.visit.image).toEqual(['https://cdn.example/x.webp']);
    expect(res.body.visit.updatedByName).toBe('Rita');
  });

  it('refuses an unknown type but keeps a legacy one the visit already has', async () => {
    await Customer.updateOne({ _id: customerId }, { $push: { visits: { date: '2026-01-01', purpose: 'Old Type', createdBy: 'u1' } } });
    const legacy = (await visitsNow())[0];
    const url = `/api/customers/${customerId}/visits/${legacy._id}`;
    expect((await send('put', url, { purpose: 'Old Type', notes: 'x' })).status).toBe(200);
    expect((await send('put', url, { purpose: 'Chat' })).status).toBe(400);
  });

  it('switching to Quick note clears a follow-up it was sent with', async () => {
    const v = await add({ followUp: 'call back', followUpDate: '2026-11-01' });
    await send('put', `/api/customers/${customerId}/visits/${v._id}`, { purpose: 'Quick Note', followUp: 'call back', followUpDate: '2026-11-01' });
    const [s] = await visitsNow();
    expect(s.followUp).toBe('');
    expect(s.followUpDate).toBe('');
  });

  it('an edit that does not mention follow-up leaves it alone', async () => {
    const v = await add({ followUp: 'call back', followUpDate: '2026-11-01' });
    await send('put', `/api/customers/${customerId}/visits/${v._id}`, { notes: 'x' });
    expect((await visitsNow())[0].followUp).toBe('call back');
  });

  it("refuses someone else's visit without the permission", async () => {
    const v = await add();
    const res = await send('put', `/api/customers/${customerId}/visits/${v._id}`, { notes: 'x' }, { _id: 'u2', permissions: ['edit_own_visits'], assignedLocations: ['*'] });
    expect(res.status).toBe(403);
  });

  it('404 for a visit that is not there', async () => {
    const res = await send('put', `/api/customers/${customerId}/visits/${new mongoose.Types.ObjectId()}`, { notes: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /visit-attachments', () => {
  it('returns a link for a photo', async () => {
    const res = await send('post', '/api/customers/visit-attachments', { data: 'data:image/jpeg;base64,AAAA' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://cdn.example/x.webp');
  });

  it('502 when the upload fails (the form keeps the photo and sends it with Save)', async () => {
    processBase64Image.mockResolvedValueOnce('data:image/jpeg;base64,AAAA');
    const res = await send('post', '/api/customers/visit-attachments', { data: 'data:image/jpeg;base64,AAAA' });
    expect(res.status).toBe(502);
  });

  it('refuses anything that is not a photo or PDF, and a login with no Visits switch', async () => {
    expect((await send('post', '/api/customers/visit-attachments', { data: 'hello' })).status).toBe(400);
    expect((await send('post', '/api/customers/visit-attachments', { data: 'data:image/png;base64,AA' }, { _id: 'u1', permissions: [] })).status).toBe(403);
  });

  it('takes a PDF too', async () => {
    const res = await send('post', '/api/customers/visit-attachments', { data: 'data:application/pdf;base64,AA' });
    expect(res.body.url).toBe('https://cdn.example/x.pdf');
  });
});

describe("PUT — Edit branch goes by the rep's branch (teamScope.js)", () => {
  let mgr, jesus, bart;
  beforeEach(async () => {
    await User.deleteMany({});
    [mgr, jesus, bart] = await User.create([
      { username: 'mgr', password: 'secret-1', email: 'mgr@x.com', location: 'Seattle', assignedLocations: ['Seattle'] },
      { username: 'jesus', password: 'secret-1', email: 'jesus@x.com', location: 'Seattle', assignedLocations: ['Seattle'] },
      { username: 'bart', password: 'secret-1', email: 'bart@x.com', location: 'Kent', assignedLocations: ['Kent'] }
    ]);
  });
  const manager = () => ({ _id: String(mgr._id), permissions: ['edit_branch_visits'], assignedLocations: ['Seattle'] });
  // A visit logged by `author` on a customer at `customerLocation`.
  const visitBy = async (author: Loose, customerLocation: Loose) => {
    const c = await Customer.findById(customerId);
    c.location = customerLocation;
    c.visits.push({ ...base(), createdBy: author._id });
    await c.save();
    return String(c.visits[c.visits.length - 1]._id);
  };

  it("lets a manager edit their own rep's visit, on another branch's customer too", async () => {
    const id = await visitBy(jesus, 'Kent');
    const res = await send('put', `/api/customers/${customerId}/visits/${id}`, { notes: 'checked' }, manager());
    expect(res.status).toBe(200);
    expect(res.body.visit.notes).toBe('checked');
  });

  it("refuses another branch's rep's visit, even on the manager's branch's customer", async () => {
    const id = await visitBy(bart, 'Seattle');
    const res = await send('put', `/api/customers/${customerId}/visits/${id}`, { notes: 'nope' }, manager());
    expect(res.status).toBe(403);
    expect((await visitsNow())[0].notes).toBe('hi');
  });

  it('lets an all-locations manager edit anyone\'s', async () => {
    const id = await visitBy(bart, 'Kent');
    const res = await send('put', `/api/customers/${customerId}/visits/${id}`, { notes: 'ok' }, { ...manager(), assignedLocations: ['*'] });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /:customerId/visits/:visitId/follow-up', () => {
  const add = async (over: Loose = {}) => (await send('post', `/api/customers/${customerId}/visits`, base(over))).body.visit;
  const patch = (id: unknown, body: Loose, user: Loose = STAFF) => send('patch', `/api/customers/${customerId}/visits/${id}/follow-up`, body, user as typeof STAFF);

  it('ticks it done on the screen’s day, by whom, with what happened — and reopens it', async () => {
    const v = await add({ followUp: 'call back', followUpDate: '2026-10-24' });
    const res = await patch(v._id, { action: 'done', today: '2026-10-22', outcome: 'Sent the quote' });
    expect(res.status).toBe(200);
    expect(res.body.visit).toMatchObject({
      followUpDoneAt: '2026-10-23T09:00:00.000', followUpDoneOn: '2026-10-22', followUpDoneBy: 'u1', followUpDoneByName: 'Rita', followUpOutcome: 'Sent the quote'
    });
    const back = await patch(v._id, { action: 'reopen' });
    expect(back.body.visit.followUpDoneAt).toBe('');
    expect(back.body.visit.followUpOutcome).toBe('');
    expect((await visitsNow())[0].followUp).toBe('call back');
  });

  it('snoozes it to a later day and adds what happened only once done', async () => {
    const v = await add({ followUp: 'call back', followUpDate: '2026-10-20' });
    expect((await patch(v._id, { action: 'note', outcome: 'x' })).status).toBe(400);
    const res = await patch(v._id, { action: 'snooze', until: '2026-11-02' });
    expect(res.status).toBe(200);
    expect(res.body.visit.followUpDate).toBe('2026-11-02');
    expect((await patch(v._id, { action: 'snooze', until: '2026-10-01' })).status).toBe(400);
  });

  it('refuses a visit with no follow-up, an unknown action, and a missing visit', async () => {
    const v = await add();
    expect((await patch(v._id, { action: 'done' })).status).toBe(400);
    const w = await add({ followUp: 'call back' });
    expect((await patch(w._id, { action: 'archive' })).status).toBe(400);
    expect((await patch(new mongoose.Types.ObjectId(), { action: 'done' })).status).toBe(404);
    expect((await patch('nope', { action: 'done' })).status).toBe(404);
  });

  it("refuses someone else's follow-up without the permission, and anyone with no edit switch at all", async () => {
    const v = await add({ followUp: 'call back' });
    expect((await patch(v._id, { action: 'done' }, { _id: 'u2', permissions: ['edit_own_visits'], assignedLocations: ['*'] })).status).toBe(403);
    expect((await patch(v._id, { action: 'done' }, { _id: 'u1', permissions: ['view_dashboard'], assignedLocations: ['*'] })).status).toBe(403);
    expect((await patch(v._id, { action: 'done' }, { _id: 'u3', permissions: ['edit_all_visits'], assignedLocations: ['*'] })).status).toBe(200);
  });
});

describe('PATCH …/follow-up keeps the record', () => {
  it('adds a line for every tick, reopen and snooze, oldest first, and never drops one', async () => {
    const v = (await send('post', `/api/customers/${customerId}/visits`, base({ followUp: 'call back', followUpDate: '2026-10-24' }))).body.visit;
    const patch = (body: Loose) => send('patch', `/api/customers/${customerId}/visits/${v._id}/follow-up`, { today: '2026-10-23', ...body });
    await patch({ action: 'snooze', until: '2026-11-02' });
    await patch({ action: 'done' });
    await patch({ action: 'note', outcome: 'Sent it' });
    await patch({ action: 'reopen' });
    const res = await patch({ action: 'snooze', until: '2026-11-09' });
    expect(res.body.visit.followUpHistory.map((e: Loose) => e.action)).toEqual(['snooze', 'done', 'reopen', 'snooze']);
    expect(res.body.visit.followUpHistory[0]).toMatchObject({ from: '2026-10-24', to: '2026-11-02', by: 'u1', byName: 'Rita', on: '2026-10-23' });
    expect(res.body.visit.followUpHistory[3]).toMatchObject({ from: '2026-11-02', to: '2026-11-09' });
    expect(res.body.visit.followUpDate).toBe('2026-11-09');
  });
});
