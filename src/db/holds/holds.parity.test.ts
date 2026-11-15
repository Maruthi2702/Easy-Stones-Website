/**
 * Cart & Holds, through the real router and the expiry job: each request run on MongoDB, then on
 * Postgres, must answer the same and leave the same records behind (`t.differences()` is the copy's own
 * check of every table, so the copy's row builders are the spec for what Postgres writes).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import createHoldsRouter from '../../holds/router.ts';
import { createHoldExpiry } from '../../holds/expiry.ts';
import { ALL_HOLD_PERMISSIONS, CART, HOLDS } from '../../holds/permissions.ts';
import { defaultExpiresOn, addDays } from '../../holds/holdRules.ts';
import InventoryItem from '../../models/InventoryItem.ts';
import Customer from '../../models/Customer.ts';
import type { Loose } from '../../types/records.ts';

// Every request is checked against a full table-by-table comparison, which takes a moment.
vi.setConfig({ testTimeout: 180000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new record's id is made by the layer: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

const oid = () => String(new mongoose.Types.ObjectId());
const as = (user: Loose) => ({ 'x-test-user': JSON.stringify(user) });
const ADMIN = { id: oid(), displayName: 'Krish', permissions: [...ALL_HOLD_PERMISSIONS], assignedLocations: ['*'], location: 'Seattle' };
const MARIA = { id: oid(), displayName: 'Maria', permissions: [...ALL_HOLD_PERMISSIONS], assignedLocations: ['Seattle'], location: 'Seattle' };
const OWN_ONLY = { id: MARIA.id, displayName: 'Maria', permissions: [CART.USE, HOLDS.VIEW_OWN, HOLDS.CREATE], assignedLocations: ['Seattle'], location: 'Seattle' };
const NOBODY = { id: oid(), displayName: 'No', permissions: [], assignedLocations: ['Seattle'] };

const acme = oid(), bella = oid();
const hex = (h: string) => new mongoose.Types.ObjectId(h);
const slab = (serial: string, over: Loose = {}) => ({
  type: 'SLAB', serialNumber: serial, barcodeId: `ES${serial.replace(/\D/g, '')}`, product: 'Taj Mahal 3CM', category: 'Quartzite',
  bundle: '007766AG/14744', slabNumber: '14', block: '004143', bin: 'A-12', location: 'Seattle', dimensions: '119" x 78"', instockQty: 64.46, ...over
});
const KEYS = ['14744-29', '14744-30', '14744-31', '14744-32', '14744-33', '14744-34'];

let t: WriteParity;
let app: express.Express;
let clock = Date.parse('2026-11-10T17:30:00.000Z');

const dueNoted = oid(), dueRelease = oid(), fresh = oid();
const holdSeed = (id: string, number: number, over: Loose) => ({
  _id: hex(id), number, status: 'active', branch: 'Seattle',
  customer: { id: acme, name: 'Acme Stone', contact: 'Ann', phone: '555', email: 'ann@acme.test', address: '1 Main' },
  job: '', notes: '', commissionNotes: '', chanceToClose: null, releaseReason: '', expiredNotedAt: null, releasedAt: null, releasedBy: null,
  lines: [], slabKeys: [], createdBy: { id: ADMIN.id, name: 'Krish' }, updatedBy: { id: ADMIN.id, name: 'Krish' },
  createdAt: new Date(`2026-10-${10 + (number % 100)}T17:00:00Z`), updatedAt: new Date(`2026-10-${10 + (number % 100)}T17:00:00Z`), __v: 0, ...over
});
const seedLine = (slabKey: string) => ({ slabKey, serial: slabKey, barcode: '', product: 'Taj', category: '', bundle: '', slabNumber: '', block: '', bin: '', location: 'Seattle', dimensions: '', sfHundredths: 6446, priceCentsPerSf: 2450, note: '' });

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany(['Seattle', 'Spokane'].map(name => ({ _id: new mongoose.Types.ObjectId(), name })));
    await Customer.insertMany([
      { _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.test', phone: '555', address: { street: '1 Main', city: 'Seattle', state: 'WA', zipCode: '98101' } },
      { _id: bella, company: 'Bella Tile', contactName: 'Bo', email: 'bo@bella.test' }
    ]);
    await InventoryItem.insertMany([...KEYS, 'OLD-1', 'OLD-2', 'FRESH-1'].map(k => slab(k, { barcodeId: `ES${k.replace(/\D/g, '')}${k.length}` })));
    // Two holds the expiry job must act on, and one it must leave alone.
    const past = new Date('2026-11-08T08:00:00Z'), longAgo = new Date('2026-10-02T08:00:00Z'), soon = new Date('2026-11-30T08:00:00Z');
    await db.collection('sales_holds').insertMany([
      holdSeed(dueNoted, 101, { expiresOn: '2026-11-01', expiresAt: past, releaseAt: soon, lines: [seedLine('OLD-1')], slabKeys: ['OLD-1'] }),
      holdSeed(dueRelease, 102, { expiresOn: '2026-10-01', expiresAt: longAgo, releaseAt: past, lines: [seedLine('OLD-2')], slabKeys: ['OLD-2'] }),
      holdSeed(fresh, 103, { expiresOn: '2027-01-01', expiresAt: soon, releaseAt: soon, lines: [seedLine('FRESH-1')], slabKeys: ['FRESH-1'] })
    ]);
    await db.collection('sales_slab_reservations').insertMany([['OLD-1', dueNoted, 101], ['OLD-2', dueRelease, 102], ['FRESH-1', fresh, 103]].map(([slabKey, holdId, holdNumber]) => ({
      _id: new mongoose.Types.ObjectId(), slabKey, holdId: hex(holdId as string), holdNumber, customerName: 'Acme Stone', branch: 'Seattle',
      by: { id: ADMIN.id, name: 'Krish' }, expiresOn: '2026-11-01', createdAt: new Date('2026-10-20T17:00:00Z'), updatedAt: new Date('2026-10-20T17:00:00Z')
    })));
    await db.collection('sales_counters').insertOne({ _id: 'hold' as unknown as mongoose.Types.ObjectId, seq: 103 });
    await db.collection('sales_hold_history').insertOne({
      _id: new mongoose.Types.ObjectId(), holdId: hex(fresh), holdNumber: 103, action: 'created', by: { id: ADMIN.id, name: 'Krish' }, at: new Date('2026-10-20T17:00:00Z'), changes: [], note: 'seeded'
    });
  }, 'DB_HOLDS');

  app = express();
  app.use(express.json());
  app.use('/api/holds', createHoldsRouter({
    authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
  }));
}, 240000);

afterAll(async () => { await t?.close(); });

/**
 * Rows Postgres holds that the copy of MongoDB wouldn't. The stock revision is left out: with the Inventory
 * switch off (as here) a hold's bump goes to MongoDB's counter, and Postgres' copy of it is not in use.
 */
const differences = async () => (await t.differences()).filter(d => !d.startsWith('inventory_revision'));

/** Each call runs at its own minute, so lists never tie on the time a hold was made. */
async function same(user: Loose, send: (a: ReturnType<typeof request>) => request.Test) {
  ids.made.length = 0;
  clock += 60000;
  const ask = async () => { ids.used = 0; const r = await send(request(app)).set(as(user)); return { status: r.status, body: r.body }; };
  const { mongo, postgres } = await t.both(ask, new Date(clock));
  expect(postgres.status, JSON.stringify(postgres.body)).toBe(mongo.status);
  expect(normalize(postgres.body)).toEqual(normalize(mongo.body));
  expect(await differences()).toEqual([]);
  return mongo;
}

// The tests run on a frozen clock that starts on 2026-11-10 (an hour a call later).
const expiresOn = () => defaultExpiresOn('Seattle', new Date('2026-11-10T20:00:00Z'));
const create = (keys: string[], over: Loose = {}) => (a: ReturnType<typeof request>) => a.post('/api/holds').send({
  requestId: `req-${keys.join('-')}`, customerId: acme, branch: 'Seattle', expiresOn: expiresOn(),
  lines: keys.map(k => ({ slabKey: k, price: '24.50' })), ...over
});

describe('the cart', () => {
  it('adds slabs (what is skipped and why), shows the cart, and tells others who has it', async () => {
    const added = await same(MARIA, a => a.post('/api/holds/cart/slabs').send({ slabKeys: [KEYS[0], KEYS[0], KEYS[1], 'NOPE-1'] }));
    expect(added.body.added).toEqual([KEYS[0], KEYS[1]]);
    await same(MARIA, a => a.post('/api/holds/cart/slabs').send({ slabKeys: [KEYS[1], KEYS[2]] }));
    await same(ADMIN, a => a.post('/api/holds/cart/slabs').send({ slabKeys: [KEYS[0], KEYS[2]] }));
    await same(MARIA, a => a.get('/api/holds/cart'));
    await same(ADMIN, a => a.post('/api/holds/slabs/status').send({ slabKeys: [...KEYS, 'OLD-1'] }));
  });

  it('scans a code, sets a customer and a note, removes one and several, then clears', async () => {
    await same(MARIA, a => a.post('/api/holds/cart/scan').send({ code: `ES${KEYS[3].replace(/\D/g, '')}${KEYS[3].length}` }));
    await same(MARIA, a => a.post('/api/holds/cart/scan').send({ code: 'ZZZ' }));
    await same(MARIA, a => a.patch('/api/holds/cart/customer').send({ customerId: acme }));
    await same(MARIA, a => a.patch(`/api/holds/cart/slabs/${KEYS[0]}`).send({ note: 'Island top' }));
    await same(MARIA, a => a.patch('/api/holds/cart/slabs/MISSING-1').send({ note: 'x' }));
    await same(MARIA, a => a.delete(`/api/holds/cart/slabs/${KEYS[1]}`));
    await same(MARIA, a => a.post('/api/holds/cart/slabs/remove').send({ slabKeys: [KEYS[2], KEYS[3]] }));
    await same(MARIA, a => a.patch('/api/holds/cart/customer').send({ customerId: null }));
    await same(MARIA, a => a.delete('/api/holds/cart'));
    await same(ADMIN, a => a.delete('/api/holds/cart'));
  });

  it('refuses a login without the cart switch', async () => {
    expect((await same(NOBODY, a => a.get('/api/holds/cart'))).status).toBe(403);
  });
});

describe('a hold, from cart to release', () => {
  let h1: Loose;

  it('creates a hold (taking the slabs out of the cart), repeats a request, and refuses a taken slab', async () => {
    await same(MARIA, a => a.post('/api/holds/cart/slabs').send({ slabKeys: [KEYS[0], KEYS[1]] }));
    await same(MARIA, a => a.patch('/api/holds/cart/customer').send({ customerId: acme }));
    h1 = (await same(MARIA, create([KEYS[0], KEYS[1]], { job: 'Kitchen', notes: 'n', chanceToClose: 60 }))).body;
    expect(h1.number).toBe(104);
    await same(MARIA, create([KEYS[0], KEYS[1]], { job: 'Kitchen', notes: 'n', chanceToClose: 60 }));
    expect((await same(ADMIN, create([KEYS[1], KEYS[2]], { requestId: 'other-request-1' }))).status).toBe(409);
    expect((await same(ADMIN, create([KEYS[2]], { branch: 'Spokane', requestId: 'spokane-request' }))).status).toBe(201);
    expect((await same(MARIA, create([KEYS[4]], { branch: 'Spokane', requestId: 'branch-request-1' }))).status).toBe(400);
    expect((await same(ADMIN, create([KEYS[4], KEYS[4]], { requestId: 'twice-request-1' }))).status).toBe(400);
    expect((await same(ADMIN, create(['GONE-1'], { requestId: 'gone-request-1' }))).status).toBe(400);
    await same(MARIA, a => a.get('/api/holds/cart'));
  });

  it('lists by scope, status, search and day; and opens one with its history', async () => {
    await same(MARIA, a => a.get('/api/holds?scope=mine'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=expired'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=expiring'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=active&search=acme'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all&search=14744-29'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all&search=104'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all&search=100%25'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all&from=2026-11-10&to=2026-11-10'));
    await same(ADMIN, a => a.get('/api/holds?scope=branch&branch=Spokane&status=all'));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=all&limit=25&page=1'));
    await same(MARIA, a => a.get('/api/holds?scope=branch&status=all'));
    await same(OWN_ONLY, a => a.get('/api/holds?scope=all'));
    await same(MARIA, a => a.get(`/api/holds/${h1._id}`));
    await same(OWN_ONLY, a => a.get(`/api/holds/${fresh}`));
    await same(ADMIN, a => a.get(`/api/holds/${fresh}`));
    await same(ADMIN, a => a.get('/api/holds/not-an-id'));
  });

  it('edits details (a new customer carries onto the locks), slabs, a swap, prices, an extension', async () => {
    const edit = async (send: (a: ReturnType<typeof request>, version: number) => request.Test) => {
      const version = (await same(ADMIN, a => a.get(`/api/holds/${h1._id}`))).body.version;
      return same(ADMIN, a => send(a, version));
    };
    const at = (path: string) => `/api/holds/${h1._id}/${path}`;
    await edit((a, version) => a.patch(at('details')).send({ version, customerId: bella, job: 'Lobby', chanceToClose: 75, lineNotes: [{ slabKey: KEYS[0], note: 'Island' }] }));
    await edit((a, version) => a.patch(at('details')).send({ version, job: 'Lobby' }));
    await edit((a, version) => a.post(at('slabs')).send({ version, add: [{ slabKey: KEYS[3], price: '20' }], remove: [KEYS[1]] }));
    await edit((a, version) => a.post(at('swap')).send({ version, from: KEYS[3], to: KEYS[4] }));
    await edit((a, version) => a.patch(at('prices')).send({ version, lines: [{ slabKey: KEYS[4], price: '$26.00' }, { slabKey: KEYS[0], price: null }] }));
    await edit((a, version) => a.post(at('extend')).send({ version, expiresOn: addDays(expiresOn(), 10) }));
    await edit((a, version) => a.post(at('extend')).send({ version, expiresOn: expiresOn() }));
    expect((await same(ADMIN, a => a.post(at('slabs')).send({ version: 0, remove: [KEYS[0]] }))).status).toBe(409);
    await edit((a, version) => a.post(at('slabs')).send({ version, remove: [KEYS[0], KEYS[4]] }));
    await edit((a, version) => a.post(at('slabs')).send({ version, add: [{ slabKey: KEYS[1] }] }));
    // From the cart: the slabs leave it once held.
    await same(ADMIN, a => a.post('/api/holds/cart/slabs').send({ slabKeys: [KEYS[5]] }));
    await edit((a, version) => a.post(at('slabs')).send({ version, add: [{ slabKey: KEYS[5], price: '1' }] }));
    await same(ADMIN, a => a.get('/api/holds/cart'));
  });

  it('releases it, frees its slabs, and then refuses a change', async () => {
    const edit = async (send: (a: ReturnType<typeof request>, version: number) => request.Test) => {
      const version = (await same(ADMIN, a => a.get(`/api/holds/${h1._id}`))).body.version;
      return same(ADMIN, a => send(a, version));
    };
    expect((await edit((a, version) => a.post(`/api/holds/${h1._id}/release`).send({ version, reason: '' }))).status).toBe(400);
    expect((await edit((a, version) => a.post(`/api/holds/${h1._id}/release`).send({ version, reason: 'Customer passed' }))).status).toBe(200);
    expect((await edit((a, version) => a.patch(`/api/holds/${h1._id}/details`).send({ version, job: 'again' }))).status).toBe(400);
    await same(ADMIN, a => a.post('/api/holds/slabs/status').send({ slabKeys: KEYS }));
    await same(ADMIN, a => a.get('/api/holds?scope=all&status=released'));
  });
});

describe('the expiry job', () => {
  it('notes what expired, releases what is past its grace period, and leaves the rest', async () => {
    ids.made.length = 0;
    const { mongo, postgres } = await t.both(async () => { ids.used = 0; return createHoldExpiry({ log: { error: () => {} } as unknown as Console }).run(new Date()); });
    expect(mongo).toEqual({ noted: 1, released: 1 });
    expect(postgres).toEqual(mongo);
    expect(await differences()).toEqual([]);
    await same(ADMIN, a => a.get(`/api/holds/${dueNoted}`));
    await same(ADMIN, a => a.get(`/api/holds/${dueRelease}`));
    // A second pass finds nothing more to do.
    const again = await t.both(async () => { ids.used = 0; return createHoldExpiry({ log: { error: () => {} } as unknown as Console }).run(new Date()); });
    expect(again.postgres).toEqual({ noted: 0, released: 0 });
    expect(again.mongo).toEqual(again.postgres);
  });
});
