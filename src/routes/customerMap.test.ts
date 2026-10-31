import type { Loose } from '../types/records.ts';
// The Route Planner's map routes (GET /api/customers/map, /map/rep-counts and
// /map/:id) against a throwaway in-memory MongoDB: only View Route Planner may
// read them, every answer is narrowed to the person's scope (the locations
// assigned in Users & Roles) before anything else, a pin is slim, and a
// customer's details come only from the details route — and only for
// customers in scope.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createCustomerMapRouter } = await import('./customerMap.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: User } = await import('../models/User.ts');

let mongo;
let app;
let store = null;
const cache = { get: vi.fn(() => store), put: vi.fn((pins) => { store = pins; return pins; }) };

const id = () => new mongoose.Types.ObjectId();
const DANA = id(); const MARCUS = id(); const ALEX = id(); const CHRIS = id();
const staff = (_id: Loose, username: string, location: string) => ({ _id, username, role: 'sales_rep', location, assignedLocations: [location], password: 'x' });

const customer = (over: Loose) => ({
  _id: id(), company: 'Co', contactName: 'Pat', email: 'pat@example.com', phone: '(206) 555-0100',
  address: { street: '1 Main St', city: 'Kent', state: 'WA' }, coordinates: { lat: 47.38, lng: -122.23 },
  geocode: { precision: 'rooftop' }, customerType: 'Fabricator', status: 'Onboarded', location: 'Kent',
  quickNote: 'Likes quartz', level: 'Level 2', modaDisplay: 'Yes', modaBinder: '2',
  visits: [{ date: '2026-08-01' }, { date: '2026-09-15' }, { date: '2026-09-02' }], ...over
});

const ids: Loose = {};
const ADMIN = { id: 'adm', role: 'admin', permissions: ['view_route_planner'], assignedLocations: ['*'] };
const MANAGER = { id: 'mgr', role: 'manager', permissions: ['view_route_planner'], assignedLocations: ['Kent', 'Seattle'], location: 'Kent' };
const NO_PERM = { id: 'np', role: 'manager', permissions: [], assignedLocations: ['Kent'] };
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const get = (path: Loose, user = MANAGER) => request(app).get(`/api/customers${path}`).set(as(user));
const companies = (res: Loose) => res.body.map((p: Loose) => p.company).sort();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use('/api/customers', createCustomerMapRouter({
    authenticate: (req: Loose, res: Loose, next: Loose) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
    requirePermission: (p: Loose) => (req: Loose, res: Loose, next: Loose) => ((req.user.permissions || []).includes(p) ? next() : res.status(403).json({})),
    cache
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  store = null;
  cache.get.mockClear();
  cache.put.mockClear();
  await User.collection.deleteMany({});
  await Customer.collection.deleteMany({});
  await User.collection.insertMany([
    staff(DANA, 'dana', 'Kent'), staff(MARCUS, 'marcus', 'Kent'), staff(ALEX, 'alex', 'Seattle'), staff(CHRIS, 'chris', 'Spokane')
  ]);
  const docs = {
    dana: customer({ company: 'Dana Stone', salesRep: DANA }),
    marcus: customer({ company: 'Marcus Granite', salesRep: MARCUS }),
    alex: customer({ company: 'Alex Tile', salesRep: ALEX, location: 'Seattle' }),
    chris: customer({ company: 'Chris Marble', salesRep: CHRIS, location: 'Spokane' }),
    openKent: customer({ company: 'Kent Walk-in', location: 'Kent', visits: [] }),
    openSpokane: customer({ company: 'Spokane Walk-in', location: 'Spokane' }),
    noPoint: customer({ company: 'No Point', salesRep: DANA, coordinates: { lat: null, lng: null } })
  };
  for (const [k, d] of Object.entries(docs)) ids[k] = String(d._id);
  await Customer.collection.insertMany(Object.values(docs));
});

describe('who may read the map', () => {
  it('needs View Route Planner', async () => {
    for (const path of ['/map', '/map/rep-counts', `/map/${id()}`]) {
      expect((await get(path, NO_PERM)).status).toBe(403);
    }
  });
});

describe('GET /map — scope', () => {
  it('gives a manager only their locations’ reps and unowned customers there', async () => {
    const res = await get('/map');
    expect(res.status).toBe(200);
    expect(companies(res)).toEqual(['Alex Tile', 'Dana Stone', 'Kent Walk-in', 'Marcus Granite']);
  });
  it('gives an admin everyone, but never a customer with no point on the map', async () => {
    const res = await get('/map', ADMIN);
    expect(companies(res)).toEqual(['Alex Tile', 'Chris Marble', 'Dana Stone', 'Kent Walk-in', 'Marcus Granite', 'Spokane Walk-in']);
  });
  it('returns only the reps asked for', async () => {
    expect(companies(await get(`/map?reps=${DANA}`))).toEqual(['Dana Stone']);
    expect(companies(await get(`/map?reps=${DANA},unassigned`))).toEqual(['Dana Stone', 'Kent Walk-in']);
  });
  it('returns nothing for a rep outside the scope, even when asked by id', async () => {
    expect((await get(`/map?reps=${CHRIS}`)).body).toEqual([]);
    expect(companies(await get(`/map?reps=${CHRIS},${DANA}`))).toEqual(['Dana Stone']);
  });
  it('returns nothing when no rep is checked', async () => {
    expect((await get('/map?reps=')).body).toEqual([]);
  });
  it('lets an admin ask for any rep', async () => {
    expect(companies(await get(`/map?reps=${CHRIS}`, ADMIN))).toEqual(['Chris Marble']);
  });
});

describe('GET /map — the pin', () => {
  it('carries what the map needs and the newest visit date, and none of the contact details', async () => {
    const [pin] = (await get(`/map?reps=${DANA}`)).body;
    expect(pin).toMatchObject({
      company: 'Dana Stone', contactName: 'Pat', city: 'Kent', customerType: 'Fabricator', status: 'Onboarded',
      location: 'Kent', precision: 'rooftop', lastVisitAt: '2026-09-15', visitCount: 3,
      coordinates: { lat: 47.38, lng: -122.23 }, salesRep: String(DANA)
    });
    for (const field of ['phone', 'email', 'marketingEmail', 'notes', 'street', 'level', 'modaBinder']) {
      expect(pin).not.toHaveProperty(field);
    }
  });
  it('has no last visit for a customer never visited', async () => {
    const pin = (await get('/map?reps=unassigned')).body.find((p: Loose) => p.company === 'Kent Walk-in');
    expect(pin.visitCount).toBe(0);
    expect(pin.lastVisitAt == null).toBe(true);
  });
  it('builds the pins once and reuses them', async () => {
    await get('/map');
    await get('/map/rep-counts');
    expect(cache.put).toHaveBeenCalledTimes(1);
    await Customer.collection.deleteMany({}); // a later request is answered from the held copy
    expect(companies(await get('/map'))).toHaveLength(4);
  });
});

describe('GET /map/rep-counts', () => {
  it('counts per rep over the person’s scope only', async () => {
    const res = await get('/map/rep-counts');
    expect(res.body).toEqual({ [DANA]: 1, [MARCUS]: 1, [ALEX]: 1, unassigned: 1 });
  });
  it('counts everyone for an admin', async () => {
    const res = await get('/map/rep-counts', ADMIN);
    expect(res.body).toEqual({ [DANA]: 1, [MARCUS]: 1, [ALEX]: 1, [CHRIS]: 1, unassigned: 2 });
  });
});

describe('GET /map/:id — the details', () => {
  it('gives the contact details of a customer in scope', async () => {
    const res = await get(`/map/${ids.dana}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      _id: ids.dana, phone: '(206) 555-0100', email: 'pat@example.com', street: '1 Main St', city: 'Kent', state: 'WA',
      level: 'Level 2', modaDisplay: 'Yes', modaBinder: '2', notes: 'Likes quartz'
    });
  });
  it('says not found for a customer outside the scope, as for one that is not there', async () => {
    expect((await get(`/map/${ids.chris}`)).status).toBe(404);
    expect((await get(`/map/${ids.openSpokane}`)).status).toBe(404);
    expect((await get(`/map/${id()}`)).status).toBe(404);
  });
  it('gives an admin any customer', async () => {
    expect((await get(`/map/${ids.chris}`, ADMIN)).status).toBe(200);
  });
  it('refuses an id that is not one', async () => {
    expect((await get('/map/not-an-id')).status).toBe(400);
  });
});
