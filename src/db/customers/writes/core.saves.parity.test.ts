/**
 * Create, edit, bulk, active and the rep rename leave MongoDB and Postgres the same
 * (writeParity.ts): the same answer, and every table equal to the copy of MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import ResourceType from '../../../models/ResourceType.ts';
import ResourceFamily from '../../../models/ResourceFamily.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { newCustomerFields, customerUpdateFields, addressFrom } from '../../../utils/customerRecord.ts';
import { basicCustomer } from '../../../utils/customerAccess.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';
import type { Loose } from '../../../types/records.ts';
import type { GeocodePatch } from './coreTypes.ts';

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), kent = oid(), rep = oid(), rep2 = oid(), ghost = oid();
const acme = newId(), plain = newId(), towered = newId(), pat = newId();
const visitId = newId(), resourceId = newId(), contactId = oid();
let t: WriteParity;
let tick = 0;
/** A new moment per call, so MongoDB never sees "nothing changed" because a save landed on the same millisecond. */
const later = () => new Date(Date.UTC(2026, 10, 10, 18, 0, ++tick));

beforeAll(async () => {
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: kent, name: 'Kent' }]);
    await db.collection('roles').insertOne({ _id: oid(), name: 'sales_rep', permissions: [] });
    await db.collection('users').insertMany([
      { _id: rep, username: 'jo', displayName: 'Jo', password: 'x', role: 'sales_rep', location: 'Seattle' },
      { _id: rep2, username: 'ann', displayName: 'Ann', password: 'x', role: 'sales_rep', location: 'Kent' }
    ]);
    await ResourceFamily.insertMany([{ name: 'tower', label: 'Display towers' }, { name: 'binder', label: 'Sample binders' }, { name: 'other', label: 'Other' }]);
    await ResourceType.insertMany([
      { name: 'Display Tower', label: 'Display Tower', family: 'tower' },
      { name: 'Sample Binder', label: 'Sample Binder', family: 'binder' },
      { name: 'Flyer', label: 'Flyer', family: 'other' }
    ]);
    await Customer.syncIndexes(); // the unique email index (autoIndex is off)
    await Customer.insertMany([
      {
        _id: acme, company: 'Acme Stone', contactName: 'Ann', email: 'ann@acme.example', phone: '555-0100',
        location: 'Seattle', salesRep: rep, salesRepName: 'Jo', status: 'Onboarded', customerType: 'Dealer',
        level: 'Level - 2', priceLevel: 2, quickNote: 'Old note',
        address: { street: '1 Main St', city: 'Seattle', state: 'WA', zipCode: '98101' },
        coordinates: { lat: 47.6, lng: -122.3 },
        geocode: { status: 'ok', precision: 'rooftop', addressKey: 'k1', formattedAddress: '1 Main St', updatedAt: new Date('2026-10-01T00:00:00Z') },
        contacts: [{ _id: contactId, name: 'Bo', phone: '555-0101', email: 'bo@acme.example', role: 'Buyer', createdAt: '2026-10-01T08:00:00.000' }],
        visits: [{
          _id: visitId, resourceId, date: '2026-10-01', purpose: 'Showroom Visit', notes: 'Looked at quartz',
          createdBy: String(rep), createdByName: 'Jo', createdAt: '2026-10-01T09:00:00.000', image: ['https://files.example/v1.jpg'],
          reactions: [{ type: 'like', userId: String(rep), userName: 'Jo', createdAt: '2026-10-01T10:00:00.000' }],
          followUp: 'Call back', followUpDate: '2026-10-08',
          followUpHistory: [{ action: 'snooze', at: '2026-10-05T09:00:00.000', on: '2026-10-05', by: String(rep), byName: 'Jo', from: '2026-10-03', to: '2026-10-08' }]
        }],
        resources: [{
          _id: resourceId, visitId, date: '2026-10-01', resourceType: 'Sample Binder', qty: 3, title: 'Sample Binder',
          status: 'Active', uploadedBy: String(rep), createdAt: '2026-10-01T09:05:00.000', image: ['https://files.example/r1.jpg']
        }],
        modaDisplay: 'No', modaBinder: '5', modaEarlier: { display: false, binders: 2 }
      },
      { _id: plain, contactName: 'Pat', email: 'pat@plain.example', location: 'Seattle' },
      {
        _id: towered, company: 'Tower Co', contactName: 'Tia', email: 'tia@tower.example', location: 'Kent', salesRep: ghost,
        resources: [{ _id: newId(), date: '2026-10-02', resourceType: 'Display Tower', title: 'Display Tower', status: 'Active', createdAt: '2026-10-02T09:00:00.000' }],
        modaDisplay: 'Yes', modaBinder: '0', modaEarlier: { display: false, binders: 0 }
      },
      { _id: pat, company: 'Pat Co', contactName: 'Pat', email: 'patco@plain.example', location: 'Seattle', salesRep: rep2, salesRepName: 'Ann' }
    ]);
  });
  expect(await t.differences()).toEqual([]);
}, 90_000);

afterAll(async () => { await t?.close(); }, 60_000);

const point = { coordinates: { lat: 47.5, lng: -122.2 }, geocode: { status: 'ok', precision: 'rooftop', formattedAddress: '', addressKey: 'k-new', updatedAt: new Date('2026-11-10T17:30:00Z'), error: '' } };
const noGeocode: GeocodePatch = async () => null;

/** The route's create: body → fields, rep resolved, a point, then the save. */
async function create(body: Loose, opts: { id?: string; createdBy?: unknown; geo?: Loose } = {}) {
  const { fields, error } = newCustomerFields(body, { now: [...String(body.company)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7), random: () => 0.5 });
  if (error) throw new Error(error);
  const rep0 = await data.resolveSalesRep(body.salesRep);
  return data.createCustomer({ id: opts.id ?? newId(), fields: fields!, rep: rep0, geo: opts.geo ?? point, createdBy: opts.createdBy ?? String(rep) });
}

describe('create', () => {
  const full = { company: 'Fresh Stone', contactName: 'Fay', email: 'Fay@Fresh.example', phone: '555-0199', status: 'New Lead', level: 'Level - 4',
    customerType: 'Builder', location: 'Kent', address: { street: '9 Elm', city: 'Kent', state: 'WA', zipCode: '98032' }, notes: 'Met at expo', salesRep: String(rep2),
    marketingEmail: 'M@Fresh.example', receiveMarketing: false, modaDisplay: 'Yes', modaBinder: '4' };
  const cases: [string, Loose][] = [
    ['every field', full],
    ['only a company: defaults, the placeholder email, the company as contact', { company: 'Bare Co' }],
    ['no rep', { ...full, email: 'norep@fresh.example', salesRep: '' }],
    ['a rep that no longer exists clears the rep', { ...full, email: 'ghost@fresh.example', salesRep: String(ghost) }],
    ['a rep id that is not an id', { ...full, email: 'junk@fresh.example', salesRep: 'nope' }],
    ['a bare city (older screens)', { company: 'City Co', city: 'Tacoma' }]
  ];
  it.each(cases)('%s: same answer, same data', async (_label, body) => {
    const id = newId();
    const { mongo, postgres } = await t.both(() => create(body, { id }), later());
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
  });

  it('a point the map gave, and none at all', async () => {
    for (const geo of [{}, { coordinates: { lat: null, lng: null }, geocode: { status: 'failed', error: 'ZERO_RESULTS', addressKey: 'x' } }]) {
      const id = newId();
      const body = { company: `Geo ${id}`, email: `${id}@geo.example` };
      const { mongo, postgres } = await t.both(() => create(body, { id, geo }), later());
      expect(normalize(postgres)).toEqual(normalize(mongo));
    }
    expect(await t.differences()).toEqual([]);
  });

  it('the same request twice: the second is refused by both, nothing doubled', async () => {
    const id = newId();
    const body = { company: 'Twice Co', email: 'twice@co.example' };
    const run = async () => { await create(body, { id }); return create(body, { id }).catch((e: Loose) => e.code); };
    const { mongo, postgres } = await t.both(run, later());
    expect(mongo).toBe(11000);
    expect(postgres).toBe(11000);
    expect(await t.differences()).toEqual([]);
  });

  it('another customer with the same email (any case) is refused by both with code 11000', async () => {
    const body = { company: 'Dup Co', email: 'ANN@acme.example' };
    const m = await t.on('mongo', () => create(body)).catch((e: Loose) => e);
    const p = await t.on('postgres', () => create(body)).catch((e: Loose) => e);
    expect(m.code).toBe(11000);
    expect(p.code).toBe(11000);
    expect(await t.differences()).toEqual([]);
  });

  it('what Mongoose refuses is refused with the same words', async () => {
    for (const bad of [{ status: 'Nope' }, { customerType: 'Alien' }, { level: 'Level - 9' }]) {
      const body = { company: 'Bad Co', email: `bad${Math.random()}@co.example`, ...bad };
      const m = await t.on('mongo', () => create(body)).catch((e: Loose) => e);
      const p = await t.on('postgres', () => create(body)).catch((e: Loose) => e);
      expect(p.message).toBe(m.message);
    }
    const m = await t.on('mongo', () => create({ company: 'X', email: 'x@y.example' }, { createdBy: 'not an id' })).catch((e: Loose) => e);
    const p = await t.on('postgres', () => create({ company: 'X', email: 'x@y.example' }, { createdBy: 'not an id' })).catch((e: Loose) => e);
    expect(p.message).toBe(m.message);
    expect(await t.differences()).toEqual([]);
  });

  it('a creator who is not a user is blanked, as the copy does', async () => {
    const id = newId();
    const { mongo, postgres } = await t.both(() => create({ company: 'Who Co', email: 'who@co.example' }, { id, createdBy: String(ghost) }), later());
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
  });

  it('a branch that is not a location is refused on Postgres (MongoDB would save a customer the copy leaves out)', async () => {
    await expect(t.on('postgres', () => create({ company: 'Lost Co', email: 'lost@co.example', location: 'Narnia' }))).rejects.toThrow(/Narnia/);
    expect(await t.differences()).toEqual([]);
  });
});

/** The route's edit: protected fields dropped, the basic card cut for a login without Full profile. */
function edit(id: string, body: Loose, opts: { profile?: boolean; geocode?: GeocodePatch } = {}) {
  const all = customerUpdateFields(body);
  const updateData = opts.profile === false ? basicCustomer(all) : all;
  return data.editCustomer(id, {
    updateData, salesRep: body.salesRep, address: body.address ? addressFrom(body) : null, city: body.city,
    geocode: opts.geocode ?? noGeocode
  });
}

describe('edit', () => {
  const same = async (id: string, body: Loose, opts: Parameters<typeof edit>[2] = {}) => {
    const { mongo, postgres } = await t.both(() => edit(id, body, opts), later());
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(await t.differences()).toEqual([]);
    return mongo;
  };

  it('plain fields on a customer with visits, resources and contacts: the answer carries them all', async () => {
    const answer = await same(acme, { company: 'Acme Stone & Tile', phone: '555-0222', quickNote: 'New note', status: 'Trying to Onboard', level: 'Level - 4', receiveMarketing: false });
    expect((answer as Loose).customer.visits).toHaveLength(1);
  });
  it('name aliases, email case, price level from the level', async () => {
    await same(acme, { name: 'Ann B', email: 'Ann@Acme.Example', notes: 'via notes', level: 'Level - 1' });
  });
  it('a login without Full profile edits the basic card only', async () => {
    await same(acme, { company: 'Basic Edit', level: 'Level - 4', receiveMarketing: true, modaBinder: '9', phone: '555-0333' }, { profile: false });
  });
  it('an edit that carries no rep leaves the rep alone', async () => {
    await same(acme, { phone: '555-0400' });
  });
  it.each([
    ['another rep', String(rep2)],
    ['no rep (handed back)', ''],
    ['null', null],
    ['a rep that is gone', String(ghost)],
    ['not an id', 'junk']
  ])('rep: %s', async (_l, salesRep) => { await same(pat, { salesRep }); });
  it('rep set back', async () => { await same(pat, { salesRep: String(rep) }); });

  it('a city-only edit keeps the stored street', async () => {
    await same(acme, { city: 'Bellevue' });
  });
  it('an address edit with a map answer stores the point; with none the point stays', async () => {
    let asked: Loose[] = [];
    const geocode: GeocodePatch = async (address, key) => { asked.push({ address, key }); return point; };
    await same(acme, { address: { street: '2 Pine', city: 'Seattle', state: 'WA', zipCode: '98102' } }, { geocode });
    expect(asked.map(a => a.key)).toEqual(['k1', 'k1']); // MongoDB's run, then Postgres's: both started from the stored key
    asked = [];
    await same(acme, { address: { street: '2 Pine', city: 'Seattle', state: 'WA', zipCode: '98102' } }, { geocode });
    expect(asked.map(a => a.key)).toEqual(['k-new', 'k-new']); // the key the first save stored
    asked = [];
    await same(acme, { address: { street: '3 Oak', city: 'Seattle' } });
  });
  it('a branch change', async () => { await same(plain, { location: 'Kent' }); });
  it('a blank branch falls back to Seattle', async () => { await same(plain, { location: '' }); });
  it('a branch that is not a location is refused on Postgres only', async () => {
    await expect(t.on('postgres', () => edit(plain, { location: 'Narnia' }))).rejects.toThrow(/Narnia/);
    expect(await t.differences()).toEqual([]);
  });
  it('keys that are not customer fields, and protected ones, change nothing', async () => {
    await same(plain, { foo: 'bar', password: 'secret', isActive: false, createdAt: '2001-01-01', sps: { key: 'x' }, phone: '555-0500' });
  });
  it('an empty edit only moves updatedAt', async () => { await same(plain, {}); });
  it('a company set to null', async () => { await same(pat, { company: null }); });

  it('no such customer: notFound from both, nothing changed', async () => {
    const { mongo, postgres } = await t.both(() => edit(newId(), { phone: '1' }), later());
    expect(mongo).toEqual({ notFound: true });
    expect(postgres).toEqual({ notFound: true });
    expect(await t.differences()).toEqual([]);
  });
  it('a garbage id is refused with the same words', async () => {
    const m = await t.on('mongo', () => edit('zzz', { phone: '1' })).catch((e: Loose) => e);
    const p = await t.on('postgres', () => edit('zzz', { phone: '1' })).catch((e: Loose) => e);
    expect(p.message).toBe(m.message);
  });

  it.each([
    ['a status that is not one', { status: 'Nope' }],
    ['a type and a status together', { status: 'Nope', customerType: 'Alien' }],
    ['a blank email', { email: '' }],
    ['a price level that is not a number', { priceLevel: 'abc' }],
    ['a company that is a list', { company: ['a', 'b'] }],
    ['a marketing flag that is not true / false', { receiveMarketing: 'x' }]
  ])('refused with the same words: %s', async (_l, body) => {
    const m = await t.on('mongo', () => edit(acme, body)).catch((e: Loose) => e);
    const p = await t.on('postgres', () => edit(acme, body)).catch((e: Loose) => e);
    expect(m).toBeInstanceOf(Error);
    expect(p.message).toBe(m.message);
    expect(await t.differences()).toEqual([]);
  });

  it('another customer\'s email is refused by both', async () => {
    await expect(t.on('mongo', () => edit(plain, { email: 'ann@acme.example' }))).rejects.toThrow();
    await expect(t.on('postgres', () => edit(plain, { email: 'ann@acme.example' }))).rejects.toThrow();
    expect(await t.differences()).toEqual([]);
  });
  it('its own email again is fine', async () => { await same(plain, { email: 'PAT@plain.example' }); });

  describe('Moda typed values (never below what resources hold)', () => {
    it('binders up: the earlier count makes it add up', async () => { await same(acme, { modaBinder: '9' }); });
    it('binders typed below the Active binders: refused with the reason', async () => {
      const { mongo, postgres } = await t.both(() => edit(acme, { modaBinder: '1' }), later());
      expect((mongo as Loose).error).toMatch(/binders are logged/);
      expect(normalize(postgres)).toEqual(normalize(mongo));
    });
    it('binders that are not a whole number', async () => {
      const { mongo, postgres } = await t.both(() => edit(acme, { modaBinder: '2.5' }), later());
      expect((mongo as Loose).error).toMatch(/whole number/);
      expect(normalize(postgres)).toEqual(normalize(mongo));
    });
    it('display No while a tower is logged: refused', async () => {
      const { mongo, postgres } = await t.both(() => edit(towered, { modaDisplay: 'No' }), later());
      expect((mongo as Loose).error).toMatch(/Display tower/);
      expect(normalize(postgres)).toEqual(normalize(mongo));
    });
    it('display Yes, and the same value typed again changes nothing', async () => {
      await same(acme, { modaDisplay: 'Yes' });
      await same(acme, { modaDisplay: 'Yes', modaBinder: '9' });
    });
    it('a customer that has no earlier count yet', async () => { await same(plain, { modaDisplay: 'Yes', modaBinder: '3' }); });
    it('moda typed by a login without Full profile is dropped', async () => { await same(plain, { modaBinder: '7', phone: '1' }, { profile: false }); });
    it('nothing was written by the refused ones', async () => { expect(await t.differences()).toEqual([]); });
  });
});

describe('bulk', () => {
  const bulk = async (ids: string[], body: Loose) => {
    const update: Loose = {};
    if (body.status !== undefined) update.status = body.status;
    if (body.salesRep !== undefined) Object.assign(update, await data.resolveSalesRep(body.salesRep));
    return data.bulkUpdateCustomers(ids, update);
  };
  it.each([
    ['a status', [acme, plain], { status: 'Inactive' }],
    ['a rep', [acme, plain, pat], { salesRep: String(rep2) }],
    ['handing accounts back', [acme, pat], { salesRep: '' }],
    ['both', [plain], { status: 'Onboarded', salesRep: String(rep) }],
    ['ids that match nobody, and one that does', [newId(), plain], { status: 'Not Interested' }],
    ['only ids that match nobody', [newId()], { status: 'Not Interested' }]
  ])('%s: same counts, same data', async (_l, ids, body) => {
    const { mongo, postgres } = await t.both(() => bulk(ids as string[], body), later());
    expect(postgres).toEqual(mongo);
    expect(await t.differences()).toEqual([]);
  });
  it('a rep id that names nobody resolves to no rep (the route refuses it before saving)', async () => {
    const { mongo, postgres } = await t.both(() => data.resolveSalesRep(String(ghost)), later());
    expect(postgres).toEqual(mongo);
  });
});

describe('active', () => {
  it.each([[false], [null], ['no'], [undefined], [true], ['no'], ['yes'], [0], [1]])('isActive %j: same data', async value => {
    const { mongo, postgres } = await t.both(() => data.setCustomerActive(plain, value), later());
    expect(postgres).toBe(mongo);
    expect(mongo).toBe(true);
    expect(await t.differences()).toEqual([]);
  });
  it.each([['maybe'], [['x']], [{}], ['TRUE'], [2], ['']])('%j cannot be cast: refused by both', async value => {
    await expect(t.on('mongo', () => data.setCustomerActive(plain, value))).rejects.toThrow();
    await expect(t.on('postgres', () => data.setCustomerActive(plain, value))).rejects.toThrow();
    expect(await t.differences()).toEqual([]);
  });
  it('no such customer: false from both', async () => {
    const { mongo, postgres } = await t.both(() => data.setCustomerActive(newId(), false), later());
    expect(mongo).toBe(false);
    expect(postgres).toBe(false);
  });
  it('a garbage id is refused by both', async () => {
    await expect(t.on('mongo', () => data.setCustomerActive('zzz', true))).rejects.toThrow();
    await expect(t.on('postgres', () => data.setCustomerActive('zzz', true))).rejects.toThrow();
  });
});

describe('a rep renamed', () => {
  it('MongoDB relabels the customers; Postgres writes nothing and the new name shows by the join', async () => {
    await t.on('mongo', async () => { await mongoose.connection.db!.collection('users').updateOne({ _id: rep }, { $set: { displayName: 'Joanna' } }); });
    const relabelled = await t.on('mongo', () => data.renameRepOnCustomers(rep, 'Joanna'));
    expect(relabelled).toBeGreaterThan(0);
    await t.resync(); // the copy of the renamed user (users stay on MongoDB until their own area moves)
    const before = await t.pg.db.select().from((await import('../../schema/customers.ts')).customers);
    const owned = await t.on('postgres', () => data.renameRepOnCustomers(rep, 'Joanna'));
    const after = await t.pg.db.select().from((await import('../../schema/customers.ts')).customers);
    expect(owned).toBe(relabelled); // it still says how many, so the route clears its caches
    expect(after).toEqual(before);  // nothing written
    expect(await t.differences()).toEqual([]);
    const names = (rows: Loose[]) => rows.filter(r => r.salesRepName).map(r => [r.company ?? '', r.salesRepName]).sort();
    expect(names(await t.on('postgres', () => data.dropdownCustomers()) as Loose[])).toEqual(names(await t.on('mongo', () => data.dropdownCustomers()) as Loose[]));
  });
  it('an id that is not one touches nobody', async () => {
    expect(await t.on('postgres', () => data.renameRepOnCustomers('junk', 'X'))).toBe(0);
    expect(await t.on('mongo', () => data.renameRepOnCustomers(newId(), 'X'))).toBe(0);
  });
});
