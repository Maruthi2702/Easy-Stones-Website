// Who gets to see where a visit was logged (src/routes/visitLocations.ts), against a throwaway
// in-memory MongoDB: your own always, your team's only with the switch, never outside the team.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Loose } from '../types/records.ts';

const { default: createVisitLocationsRouter } = await import('./visitLocations.ts');
const { default: Customer } = await import('../models/Customer.ts');
const { default: User } = await import('../models/User.ts');

let mongo!: MongoMemoryServer;
let app!: import('express').Express;
const me = new mongoose.Types.ObjectId(), mate = new mongoose.Types.ObjectId(), stranger = new mongoose.Types.ObjectId();
const mine = new mongoose.Types.ObjectId(), mates = new mongoose.Types.ObjectId(), strangers = new mongoose.Types.ObjectId(), old = new mongoose.Types.ObjectId();
const resource = new mongoose.Types.ObjectId();
const at = { lat: 47.6, lng: -122.3, accuracyM: 20, readAt: 'x', distanceM: 100, mark: 'onSite', device: 'phone', approximate: false };

const ask = (body: Loose, user: Loose) => request(app).post('/api/visit-locations').set('x-user', JSON.stringify(user)).send(body);
const viewer = (permissions: string[]) => ({ id: String(me), permissions, assignedLocations: ['Seattle'] });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use('/api/visit-locations', createVisitLocationsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-user']); req.userId = req.user.id; next(); },
    requireSalesPage: (_req: Loose, _res: Loose, next: () => void) => next()
  }));
}, 180000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Customer.deleteMany({}); await User.deleteMany({});
  await User.collection.insertMany([
    { _id: me, username: 'me', assignedLocations: ['Seattle'] }, { _id: mate, username: 'mate', assignedLocations: ['Seattle'] },
    { _id: stranger, username: 'str', assignedLocations: ['Spokane'] }
  ]);
  await Customer.create({ contactName: 'Sam', company: 'Sam Homes', email: 's@x.invalid', visits: [
    { _id: mine, date: '2026-11-19', purpose: 'Formal Presentation', createdBy: String(me), loggedFrom: at },
    { _id: mates, date: '2026-11-19', purpose: 'Formal Presentation', createdBy: String(mate), loggedFrom: at, resourceId: resource },
    { _id: strangers, date: '2026-11-19', purpose: 'Formal Presentation', createdBy: String(stranger), loggedFrom: at },
    { _id: old, date: '2026-01-01', purpose: 'Formal Presentation', createdBy: String(mate) }
  ] });
});
const all = { visitIds: [mine, mates, strangers, old].map(String), resourceIds: [String(resource)] };

describe('POST /api/visit-locations', () => {
  it('gives a rep only their own', async () => {
    const res = await ask(all, viewer(['add_visits'])).expect(200);
    expect(Object.keys(res.body.locations)).toEqual([String(mine)]);
    expect(res.body.byResource).toEqual({});
  });
  it('gives a manager with the switch their team\'s too, never outside the team, never a visit with no reading', async () => {
    const res = await ask(all, viewer(['view_branch_visits', 'see_visit_locations'])).expect(200);
    expect(Object.keys(res.body.locations).sort()).toEqual([String(mine), String(mates)].sort());
    expect(res.body.byResource[String(resource)]).toMatchObject({ mark: 'onSite' });
  });
  it('a manager without the switch sees only their own', async () => {
    const res = await ask(all, viewer(['view_branch_visits'])).expect(200);
    expect(Object.keys(res.body.locations)).toEqual([String(mine)]);
  });
  it('a login assigned to everything sees every reading with the switch', async () => {
    const res = await ask(all, { ...viewer(['view_all_visits', 'see_visit_locations']), assignedLocations: ['*'] }).expect(200);
    expect(Object.keys(res.body.locations)).toHaveLength(3);
  });
  it('ignores junk ids and refuses a huge ask', async () => {
    expect((await ask({ visitIds: ['nope', 5] }, viewer([]))).body.locations).toEqual({});
    await ask({ visitIds: Array.from({ length: 501 }, () => 'x') }, viewer([])).expect(400);
  });
});
