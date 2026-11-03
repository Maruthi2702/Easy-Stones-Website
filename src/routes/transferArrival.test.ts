import type { Loose } from '../types/records.ts';
// Log arrival (POST /api/deliveries/arrivals) against a throwaway in-memory
// MongoDB: the receiving branch records a transfer the sender never put on the
// schedule. Owner's calls, 2026-11-03: the ship date is the arrival day, the
// line goes on both branches' Daily Reports even when submitted, and anyone
// with Edit on the Delivery Schedule may log one at their own branch.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const notifyArrivalLogged = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../services/transferArrivalEmail.ts', () => ({ notifyArrivalLogged: (...args: unknown[]) => notifyArrivalLogged(...args) }));

const { default: createDeliveriesRouter } = await import('./deliveries.ts');
const { deriveFromSystem } = await import('./dailyReports.ts');
const { default: Delivery } = await import('../models/Delivery.ts');
const { default: DailyReport } = await import('../models/DailyReport.ts');
const { default: Location } = await import('../models/Location.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;
const roomsEmittedTo: string[] = [];

const VIEW_ONLY = { username: 'sam', permissions: ['view_delivery_schedule'], assignedLocations: ['Seattle'] };
const SEATTLE = { username: 'dee', displayName: 'Dee', permissions: ['view_delivery_schedule', 'edit_delivery_schedule'], assignedLocations: ['Seattle'] };
const SPOKANE = { username: 'sol', permissions: ['view_delivery_schedule', 'edit_delivery_schedule'], assignedLocations: ['Spokane'] };
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);

const DAY = '2026-10-30';
const arrival = (over: Loose = {}) => ({
  id: 'del_arrival_1', from: 'Spokane', to: 'Seattle', arrivedOn: DAY, transferNumber: '18936',
  numberOfSlabs: 12, truckId: 'trk_3rd_party', notes: 'Flatbed, no paperwork', ...over
});
const logArrival = (body: Loose, user: Loose = SEATTLE) => request(app).post('/api/deliveries/arrivals').set(as(user)).send(body);
const submitted = (location: string, transfers: Loose[] = []) => ({
  date: DAY, location, status: 'submitted' as const, submittedBy: 'Someone', submittedAt: new Date(), transfers
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.set('io', {
    emit: () => {},
    to: (room: string) => ({ emit: () => { roomsEmittedTo.push(room); } }),
    sockets: { adapter: { rooms: { keys: () => [][Symbol.iterator]() } } }
  });
  app.use('/api', createDeliveriesRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.every((p) => has(req, p)) ? next() : res.status(403).json({})),
    requireAnyPermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.some((p) => has(req, p)) ? next() : res.status(403).json({})),
    getPerformerInfo: async (req: Loose) => ({ id: 'u1', name: req.user.displayName || req.user.username }),
    processBase64Images: async (x: unknown[]) => x,
    getNowLocalISO: () => new Date().toISOString()
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  notifyArrivalLogged.mockClear();
  roomsEmittedTo.length = 0;
  await Delivery.collection.deleteMany({});
  await DailyReport.collection.deleteMany({});
  await Location.collection.deleteMany({});
  await Location.collection.insertMany([{ name: 'Seattle' }, { name: 'Spokane' }, { name: 'Salt Lake City' }]);
});

describe('who may log an arrival', () => {
  it('needs Edit on the Delivery Schedule', async () => {
    await logArrival(arrival(), VIEW_ONLY).expect(403);
    expect(await Delivery.countDocuments({})).toBe(0);
  });

  it('only at the person’s own branch', async () => {
    const res = await logArrival(arrival({ from: 'Seattle', to: 'Salt Lake City' })).expect(400);
    expect(res.body.errors).toHaveProperty('to');
    expect(await Delivery.countDocuments({})).toBe(0);
  });

  it('refuses an unknown sender, a day not yet come and a bad slab count', async () => {
    expect((await logArrival(arrival({ from: 'Atlantis' })).expect(400)).body.errors).toHaveProperty('from');
    expect((await logArrival(arrival({ arrivedOn: '2099-01-01' })).expect(400)).body.errors).toHaveProperty('arrivedOn');
    expect((await logArrival(arrival({ numberOfSlabs: -2 })).expect(400)).body.errors).toHaveProperty('numberOfSlabs');
    expect(await Delivery.countDocuments({})).toBe(0);
  });
});

describe('logging it', () => {
  it('saves the sender’s transfer, shipped and arrived that day, completed and received', async () => {
    const res = await logArrival(arrival()).expect(201);
    expect(res.body).toMatchObject({ id: 'del_arrival_1', location: 'Spokane', transferDestination: 'Seattle', status: 'completed' });
    const saved = await Delivery.findOne({ id: 'del_arrival_1' }).lean().orFail();
    expect(saved).toMatchObject({
      deliveryType: 'transfer', location: 'Spokane', transferDestination: 'Seattle', date: DAY, expectedArrivalDate: DAY,
      soNumber: '18936', numberOfSlabs: 12, truckId: 'trk_3rd_party', status: 'completed', receivedBy: 'Dee',
      notes: 'Flatbed, no paperwork', customerName: 'Transfer: Spokane → Seattle'
    });
    expect(saved.receivedAt).toBeInstanceOf(Date);
    expect(saved.arrivalLogged).toMatchObject({ byName: 'Dee', byLocation: 'Seattle' });
    expect(roomsEmittedTo).toEqual(expect.arrayContaining(['delivery-location:Spokane', 'delivery-location:Seattle']));
  });

  it('emails the sender, saying which submitted reports it was added to', async () => {
    await DailyReport.create(submitted('Spokane'));
    await logArrival(arrival()).expect(201);
    await vi.waitFor(() => expect(notifyArrivalLogged).toHaveBeenCalledTimes(1));
    const [ticket, details] = notifyArrivalLogged.mock.calls[0] as [Loose, Loose];
    expect(ticket).toMatchObject({ location: 'Spokane', transferDestination: 'Seattle' });
    expect(details).toMatchObject({ byName: 'Dee', driverName: '3rd party freight', reportsChanged: [{ location: 'Spokane', date: DAY }] });
  });

  it('answers a repeat of the same save with what it saved, once', async () => {
    await logArrival(arrival()).expect(201);
    const again = await logArrival(arrival()).expect(200);
    expect(again.body.alreadySaved).toBe(true);
    expect(await Delivery.countDocuments({})).toBe(1);
  });

  it('refuses a transfer # already on the schedule from that branch', async () => {
    await Delivery.collection.insertOne({
      id: 'sent', deliveryType: 'transfer', location: 'Spokane', transferDestination: 'Seattle', soNumber: '18936',
      date: '2026-10-29', expectedArrivalDate: DAY, truckId: 'trk_3rd_party', status: 'scheduled', customerName: 'Transfer'
    });
    const res = await logArrival(arrival()).expect(409);
    expect(res.body.existingId).toBe('sent');
    expect(await Delivery.countDocuments({})).toBe(1);
  });
});

describe('the Daily Reports', () => {
  it('adds the line to both branches’ submitted reports, once each', async () => {
    await DailyReport.create([
      submitted('Spokane', [{ fromTo: 'SPO — SLC', transferNumber: '1', count: 1, slabs: 3, auto: true, direction: 'out', ticketIds: ['x'] }]),
      submitted('Seattle')
    ]);
    const res = await logArrival(arrival()).expect(201);
    expect(res.body.reportsChanged).toEqual([{ location: 'Spokane', date: DAY }, { location: 'Seattle', date: DAY }]);

    const spokane = await DailyReport.findOne({ location: 'Spokane', date: DAY }).lean().orFail();
    expect(spokane.status).toBe('submitted');
    expect(spokane.transfers).toHaveLength(2);
    expect(spokane.transfers[1]).toMatchObject({ fromTo: 'SPO — SEA', transferNumber: '18936', slabs: 12, direction: 'out', ticketIds: ['del_arrival_1'] });
    expect(spokane.transfers[1].addedAfterSubmitAt).toBeInstanceOf(Date);

    const seattle = await DailyReport.findOne({ location: 'Seattle', date: DAY }).lean().orFail();
    expect(seattle.transfers).toHaveLength(1);
    expect(seattle.transfers[0]).toMatchObject({ fromTo: 'SPO — SEA', direction: 'in', slabs: 12, received: true, receivedBy: 'Dee' });

    const { addTransferToSubmittedReports } = await import('./dailyReports.ts');
    expect(await addTransferToSubmittedReports(await Delivery.findOne({ id: 'del_arrival_1' }).lean().orFail())).toEqual([]);
    expect((await DailyReport.findOne({ location: 'Spokane', date: DAY }).lean().orFail()).transfers).toHaveLength(2);
  });

  it('leaves a draft alone; the draft counts it on both sides when derived', async () => {
    await DailyReport.create({ date: DAY, location: 'Spokane', status: 'draft', transfers: [] });
    const res = await logArrival(arrival()).expect(201);
    expect(res.body.reportsChanged).toEqual([]);
    expect((await DailyReport.findOne({ location: 'Spokane', date: DAY }).lean().orFail()).transfers).toHaveLength(0);

    const spokane = await deriveFromSystem(DAY, 'Spokane');
    expect(spokane.transfers).toEqual([expect.objectContaining({ direction: 'out', fromTo: 'SPO — SEA', slabs: 12, ticketIds: ['del_arrival_1'] })]);
    const seattle = await deriveFromSystem(DAY, 'Seattle');
    expect(seattle.transfers).toEqual([expect.objectContaining({ direction: 'in', fromTo: 'SPO — SEA', received: true })]);
  });
});

describe('afterwards', () => {
  it('the sender can change its ship date; the receiver still can’t', async () => {
    await logArrival(arrival()).expect(201);
    const stored = await Delivery.findOne({ id: 'del_arrival_1' }).lean().orFail();
    await request(app).post('/api/deliveries').set(as(SEATTLE)).send({ ...stored, _id: undefined, date: '2026-10-28' }).expect(403);
    await request(app).post('/api/deliveries').set(as(SPOKANE)).send({ ...stored, _id: undefined, date: '2026-10-28' }).expect(200);
    const after = await Delivery.findOne({ id: 'del_arrival_1' }).lean().orFail();
    expect(after).toMatchObject({ date: '2026-10-28', expectedArrivalDate: DAY });
    expect(after.arrivalLogged).toMatchObject({ byLocation: 'Seattle' });
  });
});
