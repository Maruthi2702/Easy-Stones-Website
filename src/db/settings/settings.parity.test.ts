/**
 * The side nav order (the one app setting), through the real router: each request run on
 * MongoDB, then on Postgres, must answer the same and leave the same rows behind (the copy's
 * own check against MongoDB is the spec).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import AppSetting from '../../models/AppSetting.ts';
import { appSettings } from '../schema/misc.ts';
import { readSetting, writeSetting, removeSetting } from './index.ts';
import createNavOrderRouter from '../../routes/navOrder.ts';
import type { Loose } from '../../types/records.ts';

// Every step compares the whole copy; on a busy machine that passes 5 seconds.
vi.setConfig({ testTimeout: 90_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new row's id is made by the data layer: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ADMIN = { id: new mongoose.Types.ObjectId().toHexString(), username: 'root', permissions: ['edit_nav_order'] };
const STAFF = { id: new mongoose.Types.ObjectId().toHexString(), username: 'dee', permissions: [] };

let t: WriteParity;
let app: express.Express;

beforeAll(async () => {
  t = await openWriteParity(async () => {
    // A setting this screen doesn't own must survive every save.
    await AppSetting.create({ key: 'other', value: { keep: true }, updatedBy: 'seed' });
  }, 'DB_SETTINGS');
  app = express();
  app.use(express.json());
  const authenticate = (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); req.userId = req.user.id; next(); };
  const requireAction = (key: string) => (req: Loose, res: Loose, next: () => void) =>
    (req.user.permissions || []).includes(key) ? next() : res.status(403).json({ message: 'no' });
  app.use('/api/nav-order', createNavOrderRouter({ authenticate, requirePermission: requireAction, requireAction }));
}, 240000);

afterAll(async () => { await t?.close(); });

async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  ids.made.length = 0;
  const { mongo, postgres } = await t.both(async () => { ids.used = 0; const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; });
  expect(postgres.status).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  expect(await t.differences()).toEqual([]);
  return mongo;
}

const order = { sections: ['operations', 'sales'], items: { sales: ['lost_sales', 'customers'] } };

describe('the side nav order', () => {
  it('reads null before anything is saved', async () => {
    expect((await same(STAFF, a => a.get('/api/nav-order'))).body).toEqual({ order: null });
  });

  it('saves for an admin, reads back for everyone, and a second save changes the value not the row', async () => {
    const saved = await same(ADMIN, a => a.put('/api/nav-order').send({ order }));
    expect(saved.body.order.sections).toEqual(['operations', 'sales']);
    expect((await same(STAFF, a => a.get('/api/nav-order'))).body.order.sections).toEqual(['operations', 'sales']);
    const before = (await t.pg.db.select().from(appSettings)).find(r => r.key === 'navOrder')!;
    await same(ADMIN, a => a.put('/api/nav-order').send({ order: { sections: ['sales'], items: {} } }));
    const after = (await t.pg.db.select().from(appSettings)).find(r => r.key === 'navOrder')!;
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedBy).toBe('root');
  });

  it('refuses a login without the action and a body that is not an order', async () => {
    expect((await same(STAFF, a => a.put('/api/nav-order').send({ order }))).status).toBe(403);
    expect((await same(ADMIN, a => a.put('/api/nav-order').send({ order: 'nope' }))).status).toBe(400);
  });

  it('clearing (null) deletes the setting; clearing twice is fine', async () => {
    await same(ADMIN, a => a.put('/api/nav-order').send({ order }));
    expect((await same(ADMIN, a => a.put('/api/nav-order').send({ order: null }))).body).toEqual({ order: null });
    expect((await same(STAFF, a => a.get('/api/nav-order'))).body).toEqual({ order: null });
    await same(ADMIN, a => a.put('/api/nav-order').send({ order: null }));
  });

  it('saving the default order clears it too', async () => {
    await same(ADMIN, a => a.put('/api/nav-order').send({ order }));
    await same(ADMIN, a => a.put('/api/nav-order').send({ order: { sections: [], items: {} } }));
  });

  it('leaves other settings alone', async () => {
    expect(await t.on('mongo', () => readSetting('other'))).toEqual({ keep: true });
    expect(await t.on('postgres', () => readSetting('other'))).toEqual({ keep: true });
  });
});

describe('the layer itself', () => {
  it('any key: write, read, overwrite, remove — same on both', async () => {
    const run = async () => {
      await writeSetting(' flags ', { a: 1, nested: [1, 'x', null] }, 'dee');
      const first = await readSetting('flags');
      await writeSetting('flags', null, 'sam');
      const cleared = await readSetting('flags');
      await writeSetting('flags', 'text', 'sam');
      await removeSetting('flags');
      return { first, cleared, gone: await readSetting('flags') };
    };
    const { mongo, postgres } = await t.both(run);
    expect(postgres).toEqual(mongo);
    expect(mongo.first).toEqual({ a: 1, nested: [1, 'x', null] });
    expect(mongo.gone).toBeUndefined();
    expect(await t.differences()).toEqual([]);
  });
});
