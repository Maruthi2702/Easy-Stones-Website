// The Selection Sheet's save and email routes (PUT /api/checkin/:id,
// POST /:id/send-email) against a throwaway in-memory MongoDB: prices and
// internal notes are stored, a bad price is refused, and the sales rep's
// automatic email goes out (with prices) only when what it shows changed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../services/emailService.js', () => ({
  sendCheckInAlertEmail: vi.fn(async () => ({ success: true })),
  sendSelectionSheetEmail: vi.fn(async () => ({ success: true }))
}));

const { sendSelectionSheetEmail } = await import('../services/emailService.js');
const { default: createCheckInRouter } = await import('./checkIn.js');
const { default: OfficeCheckIn } = await import('../models/OfficeCheckIn.js');
const { default: User } = await import('../models/User.js');

let mongo;
let app;
let id;

const STAFF = { username: 'krish', permissions: ['manage_checkins', 'view_checkins', 'send_checkin_email'], assignedLocations: ['*'] };
const put = (body, user = STAFF) => request(app).put(`/api/checkin/${id}`).set('x-test-user', JSON.stringify(user)).send(body);
// The rep's email is sent in the background after the response.
const settle = () => new Promise((r) => setTimeout(r, 30));
const repEmails = () => sendSelectionSheetEmail.mock.calls.filter((c) => c[1] === 'rita@x.com');

const row = (over = {}) => ({ material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63', priceCentsPerSf: 6800, ...over });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/checkin', createCheckInRouter({
    authenticate: (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p) => (req, res, next) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({}))
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([OfficeCheckIn.collection.deleteMany({}), User.collection.deleteMany({})]);
  await User.collection.insertOne({ username: 'rita', email: 'rita@x.com', isActive: true });
  const c = await OfficeCheckIn.collection.insertOne({
    name: 'Pat Visitor', phone: '(206) 555-0142', location: 'Seattle', salesRep: 'Rita', salesRepEmail: 'rita@x.com',
    selections: [{ material: 'CALACATTA GOLD', lot: '13845', details: '7', size: '126x63' }], specialNotes: 'Old notes',
    createdAt: new Date(), updatedAt: new Date()
  });
  id = String(c.insertedId);
});

describe('PUT /api/checkin/:id — the selection sheet', () => {
  it('stores each price in cents and the internal notes', async () => {
    const res = await put({ selections: [row()], internalNotes: 'Builder pricing', specialNotes: 'Old notes' }).expect(200);
    expect(res.body.data.selections[0].priceCentsPerSf).toBe(6800);
    expect(res.body.data.internalNotes).toBe('Builder pricing');
    const saved = await OfficeCheckIn.findById(id).lean();
    expect(saved.selections[0].priceCentsPerSf).toBe(6800);
    expect(saved.internalNotes).toBe('Builder pricing');
  });

  it('a material with no price is stored as none', async () => {
    await put({ selections: [row({ priceCentsPerSf: null })] }).expect(200);
    expect((await OfficeCheckIn.findById(id).lean()).selections[0].priceCentsPerSf).toBe(null);
  });

  it('refuses a price that isn\'t positive whole cents, and saves nothing', async () => {
    for (const bad of [12.5, -100, 0, '68.00']) {
      const res = await put({ selections: [row({ priceCentsPerSf: bad })] }).expect(400);
      expect(res.body.message).toMatch(/price/i);
    }
    expect((await OfficeCheckIn.findById(id).lean()).selections[0].priceCentsPerSf).toBeUndefined();
  });

  it('emails the rep, with prices, when a price is added', async () => {
    await put({ selections: [row()] }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(1);
    expect(repEmails()[0][3]).toEqual({ showPrices: true });
    expect(repEmails()[0][0].selections[0].priceCentsPerSf).toBe(6800);
  });

  it('doesn\'t email the rep when only the internal notes change — but records the edit', async () => {
    await put({ selections: [row()] }).expect(200);
    await settle();
    vi.clearAllMocks();
    await put({ selections: [row()], internalNotes: 'Staff only' }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(0);
    const saved = await OfficeCheckIn.findById(id).lean();
    expect(saved.internalNotes).toBe('Staff only');
    expect(saved.sheetEditedBy).toBe('krish');
  });

  it('emails the rep again when the printed notes or a price change, not on a re-save of the same sheet', async () => {
    await put({ selections: [row()] }).expect(200);
    await settle();
    vi.clearAllMocks();
    await put({ selections: [row()] }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(0);
    await put({ selections: [row({ priceCentsPerSf: 7000 })] }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(1);
    await put({ selections: [row({ priceCentsPerSf: 7000 })], specialNotes: 'New printed notes' }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(2);
  });

  it('a sheet saved before prices existed doesn\'t re-email the rep on its first plain save', async () => {
    await put({ selections: [row({ priceCentsPerSf: null })], specialNotes: 'Old notes' }).expect(200);
    await settle();
    expect(repEmails()).toHaveLength(0);
  });
});

describe('POST /api/checkin/:id/send-email', () => {
  const send = (body) => request(app).post(`/api/checkin/${id}/send-email`).set('x-test-user', JSON.stringify(STAFF)).send(body);

  it('leaves prices off unless "with prices" was pressed', async () => {
    await send({ email: 'pat@example.com' }).expect(200);
    await send({ email: 'pat@example.com', withPrices: 'yes' }).expect(200);
    await send({ email: 'pat@example.com', withPrices: true }).expect(200);
    expect(sendSelectionSheetEmail.mock.calls.map((c) => c[3])).toEqual([
      { showPrices: false }, { showPrices: false }, { showPrices: true }
    ]);
  });
});
