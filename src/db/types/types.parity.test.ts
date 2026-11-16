/**
 * Visit Types, Resource Types and Families through the real router: each request run on MongoDB, then on
 * Postgres (a copy of the same seed), must answer the same and leave the same data behind — types, and the
 * customers' visits, resources and Moda counts a move rewrites (the copy's own check, `t.differences()`).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import VisitType from '../../models/VisitType.ts';
import ResourceType from '../../models/ResourceType.ts';
import ResourceFamily from '../../models/ResourceFamily.ts';
import Customer from '../../models/Customer.ts';
import Location from '../../models/Location.ts';
import { seedTypeLists } from '../../services/seedTypeLists.ts';
import { countVisitTypeUses, countResourceTypeUses, replaceVisitType, replaceResourceType, countFamilyUses, replaceFamily } from '../../services/typeReplacement.ts';
import { recountForFamilyChange } from '../../services/modaCount.ts';
import createTypeListRouter from '../../routes/typeLists.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const ACTIONS = (p: string) => ({ add: `add_${p}`, edit: `edit_${p}`, reorder: `reorder_${p}`, delete: `delete_${p}` });
const ALL = ['add', 'edit', 'reorder', 'delete'].flatMap(a => [`${a}_visit_types`, `${a}_resource_types`]);
let t: WriteParity;
let app: express.Express;

beforeAll(async () => {
  t = await openWriteParity(async () => {
    await Location.create({ name: 'Seattle', shortCode: 'SEA' });
    await seedTypeLists();
    await VisitType.create({ name: 'Site walk', label: 'Site walk', order: 10, system: false, active: true, fields: { notes: true, outcome: true, followUp: 'optional' } });
    await Customer.create({
      contactName: 'Sam', company: 'Sam Homes', email: 'sam@x.com', location: 'Seattle',
      visits: [{ date: '2026-01-01', purpose: 'Formal Presentation', createdBy: 'u1' }, { date: '2026-01-02', purpose: 'Site walk', createdBy: 'u1' }],
      resources: [{ title: '2025V3 Moda Tower', resourceType: '2025V3 Moda Tower', date: '2026-01-01', qty: 1 }, { title: 'Binders', resourceType: 'Moda Sample Binder SouthV1 12', date: '2026-01-03', qty: 4 }]
    });
  }, 'DB_TYPES');
  app = express();
  app.use(express.json());
  type TestRequest = Request & { user?: Loose; userId?: string };
  const authenticate = (req: TestRequest, _res: Response, next: NextFunction) => { req.user = { _id: 'u1', username: 'amy', permissions: ALL }; req.userId = 'u1'; next(); };
  const requireAction = (key: string) => (req: TestRequest, res: Response, next: NextFunction) => ((req.user?.permissions || []).includes(key) ? next() : void res.status(403).json({}));
  app.use('/api/visit-types', createTypeListRouter({ kind: 'visit', Model: VisitType as never, actions: ACTIONS('visit_types'), authenticate, requireAction, countUses: countVisitTypeUses, replaceUses: replaceVisitType }));
  app.use('/api/resource-types', createTypeListRouter({
    kind: 'resource', Model: ResourceType as never, actions: ACTIONS('resource_types'), authenticate, requireAction,
    countUses: countResourceTypeUses, replaceUses: replaceResourceType, onFamilyChange: recountForFamilyChange,
    families: () => ResourceFamily.find({}).select('name active').lean() as Promise<{ name: string; active?: boolean }[]>
  }));
  app.use('/api/resource-families', createTypeListRouter({ kind: 'family', Model: ResourceFamily as never, actions: ACTIONS('resource_types'), authenticate, requireAction, countUses: countFamilyUses, replaceUses: replaceFamily }));
}, 240000);

afterAll(async () => { await t?.close(); });

async function same(send: (a: ReturnType<typeof request>) => request.Test) {
  ids.made.length = 0;
  const r = await t.both(async () => { ids.used = 0; const res = await send(request(app)); return { status: res.status, body: res.body }; });
  expect(r.postgres.status).toBe(r.mongo.status);
  expect(normalize(r.postgres.body)).toEqual(normalize(r.mongo.body));
  expect(await t.differences()).toEqual([]);
  return r.mongo;
}
const find = async (path: string, name: string): Promise<Loose> => (await t.on('mongo', async () => (await request(app).get(path)).body.types)).find((x: Loose) => x.name === name);

describe('fixture', () => {
  it('copied the customer, its visits and resources', async () => {
    const S = await import('../schema/index.ts');
    expect([(await t.pg.db.select().from(S.customers)).length, (await t.pg.db.select().from(S.visits)).length, (await t.pg.db.select().from(S.resources)).length]).toEqual([1, 2, 2]);
  });
});

describe('reading', () => {
  it('lists every kind in order, the same', async () => {
    for (const path of ['/api/visit-types', '/api/resource-types', '/api/resource-families']) {
      const r = await same(a => a.get(path));
      expect(r.body.types.length).toBeGreaterThan(2);
    }
  });
});

describe('adding', () => {
  it('adds one of each kind at the bottom, refuses a repeat, and a hidden or unknown family', async () => {
    expect((await same(a => a.post('/api/visit-types').send({ label: 'Walk-in', fields: { notes: true, outcome: false, followUp: 'none' } }))).status).toBe(201);
    expect((await same(a => a.post('/api/resource-families').send({ label: 'Slab racks' }))).status).toBe(201);
    expect((await same(a => a.post('/api/resource-types').send({ label: 'Radianz Tower 2026', family: 'tower' }))).status).toBe(201);
    expect((await same(a => a.post('/api/resource-types').send({ label: 'radianz tower 2026' }))).status).toBe(400);
    expect((await same(a => a.post('/api/resource-types').send({ label: 'Mystery', family: 'nope' }))).status).toBe(400);
  });
});

describe('editing and ordering', () => {
  it('renames the label, hides, and changes fields; a family change recounts the customers holding it', async () => {
    const update = await find('/api/visit-types', 'Resource Update');
    expect((await same(a => a.put(`/api/visit-types/${update._id}`).send({ label: 'Update (resource)', active: false }))).status).toBe(200);
    const tower = await find('/api/resource-types', '2025V3 Moda Tower');
    // Into Sample binders: the customer's Moda counts change.
    const moved = await same(a => a.put(`/api/resource-types/${tower._id}`).send({ family: 'binder' }));
    expect(moved.body.recounted).toBe(1);
    // Neither Display nor Binders: recounts nobody.
    const other = await find('/api/resource-types', 'Radianz Tower 2026');
    expect((await same(a => a.put(`/api/resource-types/${other._id}`).send({ family: 'other' }))).body.recounted).toBe(0);
    expect((await same(a => a.put(`/api/resource-types/${new mongoose.Types.ObjectId().toHexString()}`).send({ label: 'x' }))).status).toBe(404);
  });

  it('saves the whole list in the order sent, and refuses a list missing one', async () => {
    const list: Loose[] = await t.on('mongo', async () => (await request(app).get('/api/visit-types')).body.types);
    const reversed = [...list].reverse().map(x => x._id);
    expect((await same(a => a.patch('/api/visit-types/reorder').send({ ids: reversed }))).body.types[0]._id).toBe(reversed[0]);
    expect((await same(a => a.patch('/api/visit-types/reorder').send({ ids: reversed.slice(1) }))).status).toBe(400);
  });
});

describe('deleting', () => {
  it('refuses a built-in one, and one in use without a type to move to', async () => {
    const quick = await find('/api/visit-types', 'Quick Note');
    expect((await same(a => a.delete(`/api/visit-types/${quick._id}`))).status).toBe(409);
    const walk = await find('/api/visit-types', 'Site walk');
    expect((await same(a => a.get(`/api/visit-types/${walk._id}/uses`))).body.uses).toBe(1);
    expect((await same(a => a.delete(`/api/visit-types/${walk._id}`).send({}))).status).toBe(409);
    const hidden = await find('/api/visit-types', 'Resource Update');   // hidden above
    expect((await same(a => a.delete(`/api/visit-types/${walk._id}`).send({ replaceWith: hidden._id }))).status).toBe(400);
  });

  it('moves the visits to the chosen type and deletes (a visit type)', async () => {
    const walk = await find('/api/visit-types', 'Site walk');
    const target = await find('/api/visit-types', 'Formal Presentation');
    const r = await same(a => a.delete(`/api/visit-types/${walk._id}`).send({ replaceWith: target._id }));
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(1);
  });

  it('moves resources to the chosen type, then deletes it (a resource type), and a family with its types', async () => {
    const binder = await find('/api/resource-types', 'Moda Sample Binder SouthV1 12');
    const tower = await find('/api/resource-types', '2025V3 Moda Tower');
    const gone = await same(a => a.delete(`/api/resource-types/${binder._id}`).send({ replaceWith: tower._id }));
    expect(gone.status).toBe(200);
    expect(gone.body.moved).toBe(1);

    const racks = await find('/api/resource-families', 'Slab racks');
    const other = await find('/api/resource-families', 'other');
    const mk = await same(a => a.post('/api/resource-types').send({ label: 'Rack A', family: 'Slab racks' }));
    expect(mk.status).toBe(201);
    const del = await same(a => a.delete(`/api/resource-families/${racks._id}`).send({ replaceWith: other._id }));
    expect(del.status).toBe(200);
    expect(del.body.moved).toBe(1);
  });
});
