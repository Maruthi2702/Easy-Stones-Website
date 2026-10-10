// Cart & Holds end to end against a real (throwaway, in-memory) MongoDB replica
// set, transactions included: permissions, the cart, scanning, creating holds,
// the one-hold-per-slab lock, who sees what, every edit, the expiry job and the
// append-only history.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import createHoldsRouter from './router.js';
import { createHoldExpiry } from './expiry.js';
import { Cart, Hold, SlabReservation, Counter, HoldHistory } from './models.js';
import { ALL_HOLD_PERMISSIONS, CART, HOLDS } from './permissions.js';
import { defaultExpiresOn, addDays } from './holdRules.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import { extractPdfTextItems } from '../utils/pdfTextItems.js';

let rs;
let app;
let customerId;
let otherCustomerId;

const ADMIN = { id: 'u1', displayName: 'Krish', permissions: [...ALL_HOLD_PERMISSIONS], assignedLocations: ['*'], location: 'Seattle' };
const MARIA = { id: 'u2', displayName: 'Maria', permissions: [...ALL_HOLD_PERMISSIONS], assignedLocations: ['Seattle'], location: 'Seattle' };
const api = (method, url, user = ADMIN) => request(app)[method](`/api/holds${url}`).set('x-test-user', JSON.stringify(user));

const slab = (serial, over = {}) => ({
  type: 'SLAB', serialNumber: serial, barcodeId: `ES${serial.replace(/\D/g, '')}`, product: 'Taj Mahal 3CM', category: 'Quartzite',
  bundle: '007766AG/14744', slabNumber: '14', block: '004143', bin: 'A-12', location: 'Seattle', dimensions: '119" x 78"', instockQty: 64.46, ...over
});
const expiresOn = () => defaultExpiresOn('Seattle');
const newHold = (slabKeys, over = {}, user = ADMIN) => api('post', '', user).send({
  requestId: `req-${Math.random().toString(36).slice(2)}`, customerId, branch: 'Seattle', expiresOn: expiresOn(),
  lines: slabKeys.map((k) => ({ slabKey: k, price: '24.50' })), ...over
});

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(rs.getUri());
  await Promise.all([Cart.init(), Hold.init(), SlabReservation.init(), HoldHistory.init()]);
  app = express();
  app.use(express.json());
  app.use('/api/holds', createHoldsRouter({
    authenticate: (req, res, next) => {
      const raw = req.headers['x-test-user'];
      if (!raw) return res.status(401).json({ error: 'Not signed in.' });
      req.user = JSON.parse(raw);
      return next();
    }
  }));
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await rs?.stop();
});

beforeEach(async () => {
  await Promise.all([Cart.deleteMany({}), Hold.deleteMany({}), SlabReservation.deleteMany({}), Counter.deleteMany({}),
    HoldHistory.collection.deleteMany({}), InventoryItem.collection.deleteMany({}), Customer.collection.deleteMany({}),
    mongoose.connection.collection('locations').deleteMany({})]);
  await InventoryItem.collection.insertMany([
    slab('14744-29'), slab('14744-30'), slab('14744-31'), slab('14744-32', { bundle: '007768AG/14744' }),
    slab('9001-1', { type: 'Sample', product: 'Sample board' }),
    slab(' lc-77 ', { barcodeId: 'ES-LOWER' })
  ]);
  const { insertedIds } = await Customer.collection.insertMany([
    { company: 'Granite and Marble Specialties', contactName: 'Kurt Karimov', phone: '425-282-6323', email: 'olena@granitemarblewa.com', address: { street: '18640 68th Ave S', city: 'Kent', state: 'WA', zipCode: '98032' } },
    { company: 'Bella Pietra', contactName: 'Ana', phone: '503-555-0100', email: 'ana@bellapietra.com' }
  ]);
  customerId = String(insertedIds[0]);
  otherCustomerId = String(insertedIds[1]);
});

describe('permissions', () => {
  it('nothing opens without its switch', async () => {
    await request(app).get('/api/holds/cart').expect(401);
    await api('get', '/cart', { ...ADMIN, permissions: [] }).expect(403);
    await api('get', '', { ...ADMIN, permissions: [CART.USE] }).expect(403);
    await api('post', '', { ...ADMIN, permissions: [CART.USE, HOLDS.VIEW_ALL] }).send({}).expect(403);
  });
});

describe('cart', () => {
  it('adds whole slabs only, once each, and says why anything was skipped', async () => {
    const res = await api('post', '/cart/slabs').send({ slabKeys: ['14744-29', '14744-29', '9001-1', 'NOPE-1', 'lc-77'] }).expect(200);
    expect(res.body.added).toEqual(['14744-29', 'LC-77']);
    // The same slab listed twice in one request simply counts once.
    expect(res.body.skipped.map((s) => s.reason)).toEqual(['Only whole slabs can go in the cart', 'Not in stock']);
    expect(res.body.cart.lines).toHaveLength(2);
    expect(res.body.cart.lines[0].slab).toMatchObject({ product: 'Taj Mahal 3CM', sfHundredths: 6446 });
  });

  it('scans by barcode (any case) or serial #', async () => {
    const byBarcode = await api('post', '/cart/scan').send({ code: 'es-lower' }).expect(200);
    expect(byBarcode.body.added).toEqual(['LC-77']);
    const bySerial = await api('post', '/cart/scan').send({ code: '14744-30' }).expect(200);
    expect(bySerial.body.added).toEqual(['14744-30']);
    await api('post', '/cart/scan').send({ code: 'ZZZ' }).expect(404);
    await api('post', '/cart/scan').send({ code: '9001-1' }).expect(400);
  });

  it('notes, customer, remove, clear — and shows who else has a slab', async () => {
    await api('post', '/cart/slabs').send({ slabKeys: ['14744-29', '14744-30'] });
    await api('post', '/cart/slabs', MARIA).send({ slabKeys: ['14744-29'] });
    let cart = (await api('patch', '/cart/slabs/14744-29').send({ note: 'Island top' }).expect(200)).body;
    expect(cart.lines.find((l) => l.slabKey === '14744-29')).toMatchObject({ note: 'Island top', othersInCart: ['Maria'] });
    cart = (await api('patch', '/cart/customer').send({ customerId }).expect(200)).body;
    expect(cart.customer.name).toBe('Granite and Marble Specialties');
    cart = (await api('delete', '/cart/slabs/14744-30').expect(200)).body;
    expect(cart.lines.map((l) => l.slabKey)).toEqual(['14744-29']);
    cart = (await api('delete', '/cart').expect(200)).body;
    expect(cart).toMatchObject({ lines: [], customer: null });
  });

  it('a held slab can’t be added', async () => {
    await newHold(['14744-29']).expect(201);
    const res = await api('post', '/cart/slabs', MARIA).send({ slabKeys: ['14744-29'] }).expect(200);
    expect(res.body.skipped[0].reason).toMatch(/On Hold #1/);
  });
});

describe('creating holds', () => {
  it('numbers from 1, snapshots slabs and prices, locks them, and empties them out of the cart', async () => {
    await api('post', '/cart/slabs').send({ slabKeys: ['14744-29', '14744-30', '14744-31'] });
    const res = await newHold(['14744-29', '14744-30'], { job: 'Miller kitchen' }).expect(201);
    expect(res.body).toMatchObject({ number: 1, state: 'active', branch: 'Seattle', job: 'Miller kitchen' });
    expect(res.body.customer).toMatchObject({ name: 'Granite and Marble Specialties', contact: 'Kurt Karimov', phone: '425-282-6323' });
    expect(res.body.totals).toMatchObject({ slabs: 2, sfHundredths: 12892, totalCents: 315854 });
    expect(await SlabReservation.countDocuments()).toBe(2);
    const cart = (await api('get', '/cart').expect(200)).body;
    expect(cart.lines.map((l) => l.slabKey)).toEqual(['14744-31']);
    expect((await newHold(['14744-31']).expect(201)).body.number).toBe(2);
  });

  it('can be saved without prices', async () => {
    const res = await api('post', '').send({ requestId: 'no-prices-1', customerId, branch: 'Seattle', expiresOn: expiresOn(), lines: [{ slabKey: '14744-29' }] }).expect(201);
    expect(res.body.totals).toMatchObject({ totalCents: null, missingPrices: 1 });
  });

  it('a double tap gets the same hold back', async () => {
    const body = { requestId: 'tap-twice-1', customerId, branch: 'Seattle', expiresOn: expiresOn(), lines: [{ slabKey: '14744-29' }] };
    const first = await api('post', '').send(body).expect(201);
    const again = await api('post', '').send(body).expect(200);
    expect(again.body._id).toBe(first.body._id);
    expect(await Hold.countDocuments()).toBe(1);
  });

  it('refuses a slab already held — and writes nothing, not even a number', async () => {
    await newHold(['14744-29']).expect(201);
    const clash = await newHold(['14744-30', '14744-29'], {}, MARIA).expect(409);
    expect(clash.body.error).toMatch(/14744-29 is On Hold #1/);
    expect(await Hold.countDocuments()).toBe(1);
    expect((await newHold(['14744-30']).expect(201)).body.number).toBe(2);
  });

  it('two people holding the same slab at the same instant: one wins', async () => {
    const [a, b] = await Promise.all([newHold(['14744-31']), newHold(['14744-31'], {}, MARIA)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await SlabReservation.countDocuments({ slabKey: '14744-31' })).toBe(1);
    expect(await Hold.countDocuments()).toBe(1);
  });

  it('checks branch, expiry and the slabs themselves', async () => {
    await newHold(['14744-29'], { branch: 'Rocky Tops, LLC' }).expect(400);
    await newHold(['14744-29'], { branch: 'Dallas' }, MARIA).expect(400);
    const long = addDays(expiresOn(), 7);
    await newHold(['14744-29'], { expiresOn: long }, { ...MARIA, permissions: MARIA.permissions.filter((p) => p !== HOLDS.EXTEND) }).expect(400);
    await newHold(['14744-29'], { expiresOn: long }).expect(201);
    await newHold(['9001-1']).expect(400);
    await newHold(['NOPE-9']).expect(400);
  });
});

describe('who sees what', () => {
  it('mine / branch / all', async () => {
    await newHold(['14744-29']).expect(201);                         // Krish's
    await newHold(['14744-30'], {}, MARIA).expect(201);              // Maria's
    const ownOnly = { ...MARIA, permissions: [HOLDS.VIEW_OWN] };
    const mine = (await api('get', '?scope=mine', ownOnly).expect(200)).body;
    expect(mine.items.map((h) => h.number)).toEqual([2]);
    await api('get', '?scope=all', ownOnly).expect(403);
    const krishsHold = await Hold.findOne({ number: 1 });
    await api('get', `/${krishsHold._id}`, ownOnly).expect(404);
    const branch = (await api('get', '?scope=branch', { ...MARIA, permissions: [HOLDS.VIEW_BRANCH] }).expect(200)).body;
    expect(branch.items).toHaveLength(2);
    expect(branch.counts).toMatchObject({ active: 2, all: 2 });
  });

  it('searches by hold #, customer or slab serial', async () => {
    await newHold(['14744-29']).expect(201);
    await newHold(['14744-30'], { customerId: otherCustomerId }).expect(201);
    expect((await api('get', '?scope=all&search=bella').expect(200)).body.items.map((h) => h.number)).toEqual([2]);
    expect((await api('get', '?scope=all&search=14744-29').expect(200)).body.items.map((h) => h.number)).toEqual([1]);
    expect((await api('get', '?scope=all&search=2').expect(200)).body.items.map((h) => h.number)).toEqual([2]);
  });
});

describe('changing a hold', () => {
  const load = async (n = 1) => Hold.findOne({ number: n }).lean();

  it('each change needs its own switch', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load();
    const noEdit = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== HOLDS.EDIT) };
    await api('patch', `/${h._id}/details`, noEdit).send({ version: h.__v, job: 'x' }).expect(403);
    const noPrices = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== HOLDS.PRICES) };
    await api('patch', `/${h._id}/prices`, noPrices).send({ version: h.__v, lines: [{ slabKey: '14744-29', price: '30' }] }).expect(403);
  });

  it('details, customer and slab notes — logged', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load();
    const res = await api('patch', `/${h._id}/details`).send({ version: h.__v, customerId: otherCustomerId, job: 'Lobby', chanceToClose: 75, lineNotes: [{ slabKey: '14744-29', note: 'Island' }] }).expect(200);
    expect(res.body).toMatchObject({ job: 'Lobby', chanceToClose: 75, customer: { name: 'Bella Pietra' } });
    expect(res.body.lines[0].note).toBe('Island');
    expect((await SlabReservation.findOne({ slabKey: '14744-29' })).customerName).toBe('Bella Pietra');
    expect(await HoldHistory.countDocuments({ action: 'edited' })).toBe(1);
  });

  it('add, remove and swap slabs move the locks with them', async () => {
    await newHold(['14744-29', '14744-30']).expect(201);
    let h = await load();
    let res = await api('post', `/${h._id}/slabs`).send({ version: h.__v, add: [{ slabKey: '14744-31', price: '20' }], remove: ['14744-30'] }).expect(200);
    expect(res.body.slabKeys.sort()).toEqual(['14744-29', '14744-31']);
    expect((await SlabReservation.find().lean()).map((r) => r.slabKey).sort()).toEqual(['14744-29', '14744-31']);
    h = await load();
    res = await api('post', `/${h._id}/swap`).send({ version: h.__v, from: '14744-31', to: '14744-32' }).expect(200);
    expect(res.body.lines.find((l) => l.slabKey === '14744-32').priceCentsPerSf).toBe(2000);
    expect(await SlabReservation.countDocuments({ slabKey: '14744-31' })).toBe(0);
    h = await load();
    await api('post', `/${h._id}/slabs`).send({ version: h.__v, remove: ['14744-29', '14744-32'] }).expect(400);
  });

  it('slabs added from the cart leave the cart, as on create', async () => {
    await newHold(['14744-29']).expect(201);
    await api('post', '/cart/slabs').send({ slabKeys: ['14744-30', '14744-31'] }).expect(200);
    const h = await load();
    await api('post', `/${h._id}/slabs`).send({ version: h.__v, add: [{ slabKey: '14744-30', price: '24.50' }] }).expect(200);
    const cart = (await api('get', '/cart').expect(200)).body;
    expect(cart.lines.map((l) => l.slabKey)).toEqual(['14744-31']);
  });

  it('prices per slab', async () => {
    await newHold(['14744-29', '14744-30']).expect(201);
    const h = await load();
    const res = await api('patch', `/${h._id}/prices`).send({ version: h.__v, lines: [{ slabKey: '14744-30', price: '$26.00' }, { slabKey: '14744-29', price: null }] }).expect(200);
    expect(res.body.totals).toMatchObject({ totalCents: null, pricedCents: 167596, missingPrices: 1 });
  });

  it('extend moves the expiry and the release date', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load();
    const later = addDays(h.expiresOn, 10);
    const res = await api('post', `/${h._id}/extend`).send({ version: h.__v, expiresOn: later }).expect(200);
    expect(res.body.expiresOn).toBe(later);
    expect(new Date(res.body.releaseAt) > new Date(h.releaseAt)).toBe(true);
  });

  it('release frees the slabs; a released hold is final', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load();
    await api('post', `/${h._id}/release`).send({ version: h.__v, reason: '' }).expect(400);
    const res = await api('post', `/${h._id}/release`).send({ version: h.__v, reason: 'Customer passed' }).expect(200);
    expect(res.body).toMatchObject({ state: 'released', releaseReason: 'Customer passed' });
    expect(await SlabReservation.countDocuments()).toBe(0);
    const after = await load();
    await api('patch', `/${h._id}/details`).send({ version: after.__v, job: 'again' }).expect(400);
    await newHold(['14744-29'], {}, MARIA).expect(201);
  });

  it('a stale screen can’t overwrite someone else’s change', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load();
    await api('patch', `/${h._id}/details`).send({ version: h.__v, job: 'A' }).expect(200);
    const stale = await api('patch', `/${h._id}/details`, MARIA).send({ version: h.__v, job: 'B' }).expect(409);
    expect(stale.body.error).toMatch(/changed by someone else/);
    expect((await load()).job).toBe('A');
  });
});

describe('expiry', () => {
  it('expired keeps the slabs for 7 days, then they are released — both logged', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load1();
    const job = createHoldExpiry({ log: { error: () => {} } });
    expect(await job.run(new Date(h.expiresAt.getTime() - 1000))).toEqual({ noted: 0, released: 0 });
    expect(await job.run(new Date(h.expiresAt.getTime() + 1000))).toEqual({ noted: 1, released: 0 });
    expect(await job.run(new Date(h.expiresAt.getTime() + 2000))).toEqual({ noted: 0, released: 0 });
    expect(await SlabReservation.countDocuments()).toBe(1);
    expect(await job.run(new Date(h.releaseAt.getTime() + 1000))).toEqual({ noted: 0, released: 1 });
    expect(await SlabReservation.countDocuments()).toBe(0);
    expect((await load1()).status).toBe('released');
    expect((await HoldHistory.find({ holdId: h._id }).lean()).map((e) => e.action).sort()).toEqual(['created', 'expired', 'released']);
  });
});

describe('history and PDF', () => {
  it('history can’t be edited or deleted, and shows only with its switch', async () => {
    await newHold(['14744-29']).expect(201);
    const h = await load1();
    await expect(HoldHistory.updateOne({ holdId: h._id }, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(HoldHistory.deleteMany({})).rejects.toThrow(/append-only/);
    expect((await api('get', `/${h._id}`).expect(200)).body.history).toHaveLength(1);
    const noHistory = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== HOLDS.HISTORY) };
    expect((await api('get', `/${h._id}`, noHistory).expect(200)).body.history).toBeUndefined();
  });

  it('prints the customer letter, with only what the preview leaves showing', async () => {
    await mongoose.connection.collection('locations').insertOne({ name: 'Seattle', primaryContact: { address: { street: '18 Branch Rd', city: 'Kent', state: 'WA', zipCode: '98032' } } });
    await newHold(['14744-29', '14744-32'], { notes: 'Customer viewing Tuesday.' }).expect(201);
    const h = await load1();
    const res = await api('get', `/${h._id}/pdf`).buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    const words = async (buf) => (await extractPdfTextItems(buf)).map((i) => i.str).join(' ');
    const letter = await words(res.body);
    expect(letter).toContain('Hold Information Letter - Customer');
    expect(letter).toContain('Easy Stones - Seattle');
    expect(letter).toContain('18 Branch Rd'); // the branch's own address
    expect(letter).toContain('$24.50');
    expect(letter).not.toContain('Customer viewing Tuesday'); // internal notes stay internal
    const bare = await api('get', `/${h._id}/pdf?hide=pricing,inventory`).buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
    const bareText = await words(bare.body);
    expect(bareText).not.toContain('$');
    expect(bareText).not.toContain('14744-29');
    const noPrint = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== HOLDS.PRINT) };
    await api('get', `/${h._id}/pdf`, noPrint).expect(403);
  });
});

async function load1() { return Hold.findOne({ number: 1 }).lean(); }
