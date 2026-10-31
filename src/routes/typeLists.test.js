// The Visit Types / Resource Types routes and their first-start seed
// (src/routes/typeLists.js, src/services/seedTypeLists.js), on an in-memory MongoDB.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: createTypeListRouter } = await import('./typeLists.js');
const { default: VisitType } = await import('../models/VisitType.js');
const { default: ResourceType } = await import('../models/ResourceType.js');
const { default: Customer } = await import('../models/Customer.js');
const { seedTypeLists } = await import('../services/seedTypeLists.js');

let mongo;
let app;
const ACTIONS = (p) => ({ add: `add_${p}`, edit: `edit_${p}`, reorder: `reorder_${p}`, delete: `delete_${p}` });
const ALL = ['add', 'edit', 'reorder', 'delete'].flatMap((a) => [`${a}_visit_types`, `${a}_resource_types`]);
const send = (method, url, body, permissions = ALL) =>
  request(app)[method](url).set('x-test-user', JSON.stringify({ _id: 'u1', username: 'amy', permissions })).send(body);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  const authenticate = (req, res, next) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); req.userId = req.user._id; next(); };
  const requireAction = (key) => (req, res, next) => ((req.user.permissions || []).includes(key) ? next() : res.status(403).json({}));
  app.use('/api/visit-types', createTypeListRouter({
    kind: 'visit', Model: VisitType, actions: ACTIONS('visit_types'), authenticate, requireAction,
    countUses: (name) => Customer.countDocuments({ 'visits.purpose': name })
  }));
  app.use('/api/resource-types', createTypeListRouter({
    kind: 'resource', Model: ResourceType, actions: ACTIONS('resource_types'), authenticate, requireAction,
    countUses: (name) => Customer.countDocuments({ 'resources.resourceType': name })
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

beforeEach(async () => {
  await Customer.deleteMany({});
  await VisitType.deleteMany({});
  await ResourceType.deleteMany({});
  await seedTypeLists();
});

const list = async (path) => (await send('get', path)).body.types;

describe('first-start seed', () => {
  it('fills both lists once, in the old order, and never overwrites a manager’s changes', async () => {
    const visits = await list('/api/visit-types');
    expect(visits).toHaveLength(10);
    expect(visits[0]).toMatchObject({ name: 'Quick Note', label: 'Quick note', system: true, fields: { followUp: 'none', outcome: false } });
    expect(visits[1].fields).toEqual({ notes: false, outcome: false, followUp: 'always' });
    const resources = await list('/api/resource-types');
    expect(resources).toHaveLength(16);
    expect(resources.find((t) => t.name === '2025V3 Moda Tower').family).toBe('tower');
    expect(resources.find((t) => t.name === 'Moda Sample Binder SouthV1 12').family).toBe('binder');

    await send('put', `/api/visit-types/${visits[0]._id}`, { label: 'Quick note!' });
    await seedTypeLists();
    expect((await list('/api/visit-types'))[0].label).toBe('Quick note!');
    expect(await list('/api/visit-types')).toHaveLength(10);
  });

  it('adds names old records already carry as hidden types', async () => {
    await VisitType.deleteMany({});
    await ResourceType.deleteMany({});
    await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com',
      visits: [{ date: '2026-01-01', purpose: 'Chat', createdBy: 'u1' }, { date: '2026-01-02', purpose: 'Resource Placement: Moda Tower', createdBy: 'u1' }],
      resources: [{ title: 'Old rack', resourceType: 'Old rack', date: '2026-01-01' }]
    });
    await seedTypeLists();
    const visits = await list('/api/visit-types');
    expect(visits.find((t) => t.name === 'Chat')).toMatchObject({ active: false, system: false });
    expect(visits.find((t) => t.name.startsWith('Resource Placement:'))).toBeUndefined();
    expect((await list('/api/resource-types')).find((t) => t.name === 'Old rack')).toMatchObject({ active: false, family: 'other' });
  });
});

describe('add', () => {
  it('adds at the bottom with the name as its stored value, and refuses a repeat', async () => {
    const res = await send('post', '/api/resource-types', { label: 'Radianz Tower 2026', family: 'tower' });
    expect(res.status).toBe(201);
    expect(res.body.type).toMatchObject({ name: 'Radianz Tower 2026', family: 'tower', active: true, order: 16 });
    const again = await send('post', '/api/resource-types', { label: 'radianz tower 2026' });
    expect(again.status).toBe(400);
  });

  it('a visit type takes the fields it uses', async () => {
    const res = await send('post', '/api/visit-types', { label: 'Site walk', fields: { notes: true, outcome: false, followUp: 'none' } });
    expect(res.body.type.fields).toEqual({ notes: true, outcome: false, followUp: 'none' });
  });

  it('needs the Add action', async () => {
    expect((await send('post', '/api/visit-types', { label: 'X' }, ['edit_visit_types'])).status).toBe(403);
    expect((await send('post', '/api/visit-types', { label: 'X' }, ['add_resource_types'])).status).toBe(403);
  });
});

describe('edit', () => {
  it('renames the label but never the stored name; hides and shows', async () => {
    const [first] = await list('/api/visit-types');
    const res = await send('put', `/api/visit-types/${first._id}`, { label: 'Note', active: false });
    expect(res.body.type).toMatchObject({ name: 'Quick Note', label: 'Note', active: false });
    expect((await send('put', `/api/visit-types/${first._id}`, { label: 'Follow-up notes' })).status).toBe(400);
  });

  it('keeping the same label is fine', async () => {
    const [first] = await list('/api/visit-types');
    expect((await send('put', `/api/visit-types/${first._id}`, { label: first.label, active: true })).status).toBe(200);
  });

  it('404 for an unknown id, and needs the Edit action', async () => {
    expect((await send('put', `/api/visit-types/${new mongoose.Types.ObjectId()}`, { active: false })).status).toBe(404);
    expect((await send('put', '/api/visit-types/nope', { active: false })).status).toBe(404);
    const [first] = await list('/api/visit-types');
    expect((await send('put', `/api/visit-types/${first._id}`, { active: false }, ['add_visit_types'])).status).toBe(403);
  });
});

describe('reorder', () => {
  it('saves the whole list in the order sent, and everyone reads it', async () => {
    const types = await list('/api/resource-types');
    const ids = types.map((t) => t._id);
    const moved = [ids[5], ...ids.slice(0, 5), ...ids.slice(6)];
    const res = await send('patch', '/api/resource-types/reorder', { ids: moved });
    expect(res.status).toBe(200);
    expect(res.body.types.map((t) => t._id)).toEqual(moved);
    expect((await list('/api/resource-types')).map((t) => t._id)).toEqual(moved);
  });

  it('refuses a list missing a type or repeating one', async () => {
    const ids = (await list('/api/resource-types')).map((t) => t._id);
    expect((await send('patch', '/api/resource-types/reorder', { ids: ids.slice(1) })).status).toBe(400);
    expect((await send('patch', '/api/resource-types/reorder', { ids: [ids[0], ...ids.slice(0, -1)] })).status).toBe(400);
  });

  it('needs the Reorder action', async () => {
    expect((await send('patch', '/api/visit-types/reorder', { ids: [] }, ['edit_visit_types'])).status).toBe(403);
  });
});

describe('delete', () => {
  it('deletes a type nothing uses', async () => {
    const { body } = await send('post', '/api/resource-types', { label: 'Temp rack' });
    expect((await send('delete', `/api/resource-types/${body.type._id}`)).status).toBe(200);
    expect((await list('/api/resource-types')).some((t) => t.name === 'Temp rack')).toBe(false);
  });

  it('keeps a type a resource uses — hide it instead', async () => {
    const { body } = await send('post', '/api/resource-types', { label: 'Used rack' });
    await Customer.create({ contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com', resources: [{ title: 'Used rack', resourceType: 'Used rack' }] });
    const res = await send('delete', `/api/resource-types/${body.type._id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Hide it/);
  });

  it('never deletes a built-in visit type', async () => {
    const [first] = await list('/api/visit-types');
    expect((await send('delete', `/api/visit-types/${first._id}`)).status).toBe(409);
  });
});
