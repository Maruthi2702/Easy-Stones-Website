// Team access against a throwaway in-memory MongoDB: a manager with
// manage_team_users sees and unlocks only the roles an admin listed, at their
// own locations; an admin sees everyone; anyone else is refused.
// `authenticate` is a stand-in: the test sends the acting user as a header.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('../services/emailService.js', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

const { default: createUserOnboardingRouter } = await import('./userOnboarding.js');
const { default: User } = await import('../models/User.js');
const { default: Role } = await import('../models/Role.js');
const { createTeamAccess } = await import('../services/teamAccess.js');

let mongo;
let app;
let manager;

const make = (over) => new User({ password: 'Granite-4821-Ridge', email: 'x@x.com', ...over }).save();
const as = (user) => ({ 'x-acting': JSON.stringify(user) });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const authenticate = (req, res, next) => {
    if (!req.headers['x-acting']) return res.status(401).json({ error: 'none' });
    req.user = JSON.parse(req.headers['x-acting']);
    next();
  };
  const requirePermission = (p) => (req, res, next) => (req.user?.permissions.includes(p) ? next() : res.status(403).json({ message: 'No' }));
  const { usersAccess, memberAllowed, teamUsers } = createTeamAccess({ Role, User });
  app = express();
  app.use(express.json());
  app.get('/api/list', authenticate, usersAccess, async (req, res) => res.json(req.teamScope ? await teamUsers(req) : await User.find()));
  app.use('/api', createUserOnboardingRouter({
    authenticate, requirePermission, loginLimiter: (q, r, n) => n(), jwtSecret: 's', usersAccess, memberAllowed
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

let rep;
let spokaneRep;
let otherManager;
let teamActor;
const adminActor = { id: 'a', role: 'admin', permissions: ['manage_users'], assignedLocations: ['*'] };

beforeEach(async () => {
  await User.collection.deleteMany({});
  await Role.collection.deleteMany({});
  await Role.create({ name: 'manager', displayName: 'Manager', permissions: ['manage_team_users'], manageableRoles: ['sales_rep', 'driver'] });
  manager = await make({ username: 'mia', role: 'manager', assignedLocations: ['Seattle'] });
  rep = await make({ username: 'rita', role: 'sales_rep', assignedLocations: ['Seattle'], loginAttempts: 5, lockUntil: new Date(Date.now() + 600000) });
  spokaneRep = await make({ username: 'sam', role: 'sales_rep', assignedLocations: ['Spokane'] });
  otherManager = await make({ username: 'max', role: 'manager', assignedLocations: ['Seattle'] });
  teamActor = { id: String(manager._id), role: 'manager', permissions: ['manage_team_users'], assignedLocations: ['Seattle'] };
});

describe('the Users list', () => {
  it('shows a manager only listed roles at their locations, without themselves', async () => {
    const res = await request(app).get('/api/list').set(as(teamActor)).expect(200);
    expect(res.body.map((u) => u.username)).toEqual(['rita']);
  });
  it('leaves out passwords and tokens', async () => {
    const res = await request(app).get('/api/list').set(as(teamActor)).expect(200);
    expect(res.body[0].password).toBeUndefined();
    expect(res.body[0].googleAccessToken).toBeUndefined();
  });
  it('shows an admin everyone', async () => {
    const res = await request(app).get('/api/list').set(as(adminActor)).expect(200);
    expect(res.body).toHaveLength(4);
  });
  it('shows nobody for a role with no listed roles', async () => {
    await Role.updateOne({ name: 'manager' }, { manageableRoles: [] });
    const res = await request(app).get('/api/list').set(as(teamActor)).expect(200);
    expect(res.body).toEqual([]);
  });
  it('refuses someone with neither permission', async () => {
    await request(app).get('/api/list').set(as({ ...teamActor, permissions: ['view_customers'] })).expect(403);
  });
});

describe('unlocking', () => {
  it('works on someone in scope', async () => {
    await request(app).post(`/api/admin/users/${rep._id}/unlock`).set(as(teamActor)).expect(200);
    expect((await User.findById(rep._id)).loginAttempts).toBe(0);
  });
  it('is refused for another location, an unlisted role, and themselves', async () => {
    await request(app).post(`/api/admin/users/${spokaneRep._id}/unlock`).set(as(teamActor)).expect(403);
    await request(app).post(`/api/admin/users/${otherManager._id}/unlock`).set(as(teamActor)).expect(403);
    await request(app).post(`/api/admin/users/${manager._id}/unlock`).set(as(teamActor)).expect(403);
  });
  it('still works for an admin on anyone', async () => {
    await request(app).post(`/api/admin/users/${spokaneRep._id}/unlock`).set(as(adminActor)).expect(200);
  });
});
