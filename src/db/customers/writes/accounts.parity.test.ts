/**
 * Contacts, partners, website sign-in / passwords and the geocoding job's map point
 * leave MongoDB and Postgres the same (writeParity.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Customer from '../../../models/Customer.ts';
import * as data from '../index.ts';
import { normalize } from '../parity.ts';
import { newId } from '../../ids.ts';
import { openWriteParity, type WriteParity } from './writeParity.ts';

// bcrypt and two databases per step: slow when the machine is busy.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const oid = () => new mongoose.Types.ObjectId();
const seattle = oid(), dallas = oid();
const ann = newId(), bob = newId(), cat = newId(), dan = newId(), eve = newId(), legacy = newId(), gone = newId(), old = newId(), locked = newId(), plain = newId();
const legacyContactId = newId();
let t: WriteParity;

const PW = 'secret-pass-1';
const T0 = new Date('2026-11-10T17:30:00.000Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

beforeAll(async () => {
  // A fixed salt: both databases hash the same password to the same text.
  vi.spyOn(bcrypt, 'genSalt').mockResolvedValue('$2b$10$abcdefghijklmnopqrstuu');
  t = await openWriteParity(async db => {
    await db.collection('locations').insertMany([{ _id: seattle, name: 'Seattle' }, { _id: dallas, name: 'Dallas' }]);
    await Customer.insertMany([
      { _id: ann, company: 'Ann Stone', contactName: 'Ann', email: 'ann@acme.example', password: PW, location: 'Seattle',
        contacts: [
          { _id: oid(), name: 'First', phone: '111', email: 'first@acme.example', role: 'Buyer', notes: 'n1', createdAt: '2026-10-01T09:00:00.000' },
          { _id: oid(), name: 'Second', createdAt: '2026-10-02T09:00:00.000' }
        ] },
      { _id: bob, contactName: 'Bob', email: 'bob@acme.example', location: 'Dallas' },
      { _id: cat, contactName: 'Cat', email: 'cat@acme.example', location: 'Seattle' },
      { _id: dan, contactName: 'Dan', email: 'dan@acme.example', location: 'Seattle' },
      { _id: eve, contactName: 'Eve', email: 'eve@acme.example', location: 'Seattle' },
      { _id: locked, contactName: 'Lock', email: 'lock@acme.example', password: PW, location: 'Seattle', loginAttempts: 4 },
      { _id: plain, contactName: 'Plain', email: 'plain@acme.example', location: 'Seattle' }
    ]);
    // Older records, saved before Mongoose filled in its defaults or ids.
    await db.collection('customers').insertOne({
      _id: new mongoose.Types.ObjectId(legacy), contactName: 'Legacy', email: 'legacy@acme.example', location: 'Seattle',
      contacts: [{ name: 'No id one' }, { _id: new mongoose.Types.ObjectId(legacyContactId), name: 'Has id' }, { name: 'No id two' }],
      associatedCustomers: [new mongoose.Types.ObjectId(gone)]
    });
    await db.collection('customers').insertOne({
      _id: new mongoose.Types.ObjectId(old), contactName: 'Old', email: 'old@acme.example', location: 'Seattle', status: 'Lead'
    });
  });
  expect(await t.differences()).toEqual([]);
}, 90_000);

afterAll(async () => { vi.restoreAllMocks(); await t?.close(); });

/** Both databases answer the same and hold the same data afterwards. */
async function same<T>(run: () => Promise<T>, at?: Date) {
  const { mongo, postgres } = await t.both(run, at);
  expect(normalize(postgres)).toEqual(normalize(mongo));
  expect(await t.differences()).toEqual([]);
  return mongo;
}

/** Both refuse, and leave the data alone. */
async function bothRefuse(run: () => Promise<unknown>) {
  await expect(t.on('mongo', run)).rejects.toThrow();
  await expect(t.on('postgres', run)).rejects.toThrow();
  expect(await t.differences()).toEqual([]);
}

const contact = (over: Record<string, unknown> = {}) => ({
  name: 'New Person', phone: '555-0100', email: 'new@acme.example', role: 'Owner', notes: 'Call first',
  createdAt: '2026-11-10T09:30:15.123', createdBy: 'u1', ...over
});

describe('add contact', () => {
  it('on a customer with none, with several, and with older id-less contacts', async () => {
    for (const id of [bob, ann, legacy]) {
      const cid = newId();
      expect(await same(() => data.addContact(id, cid, contact()))).toBe(true);
    }
  });

  it('blank and missing fields, trimmed name, numbers as text', async () => {
    const c1 = newId(), c2 = newId();
    await same(() => data.addContact(cat, c1, { createdAt: '2026-11-10T09:30:15.123' }));
    await same(() => data.addContact(cat, c2, contact({ name: '  Padded Name  ', phone: 5551234, email: null, role: undefined })));
  });

  it('no such customer: false from both, nothing changed', async () => {
    const [x, y] = [newId(), newId()];
    expect(await same(() => data.addContact(x, y, contact()))).toBe(false);
  });

  it('a malformed customer id, or a list in a field, is refused by both', async () => {
    await bothRefuse(() => data.addContact('not-an-id', newId(), contact()));
    await bothRefuse(() => data.addContact(cat, newId(), contact({ name: ['a'] })));
    await bothRefuse(() => data.addContact(cat, newId(), contact({ notes: { a: 1 } })));
  });
});

describe('edit contact', () => {
  let ids: string[];
  beforeAll(async () => {
    const row = await t.on('mongo', () => Customer.findById(ann).lean());
    ids = (row!.contacts as { _id: unknown }[]).map(c => String(c._id));
  });

  it('one field, several fields, a trimmed name', async () => {
    expect(await same(() => data.updateContact(ann, ids[0], { phone: '999' }, 'u1'))).toBe(true);
    expect(await same(() => data.updateContact(ann, ids[1], { name: '  Renamed ', email: 'r@acme.example', role: 'Boss', notes: 'x' }, 'u1'))).toBe(true);
  });

  it('numbers become text, null and an empty text blank it, createdAt is a local clock time', async () => {
    await same(() => data.updateContact(ann, ids[0], { phone: 42, email: null, role: '', createdAt: '2026-11-09T08:00:00.000' }, 'u1'));
    await same(() => data.updateContact(ann, ids[1], { createdAt: null }, 'u1'));
  });

  it('keys the contact does not have are ignored; a body with only those still finds it', async () => {
    await same(() => data.updateContact(ann, ids[0], { isPrimary: true, foo: 'bar', 'x.y': 1 }, 'u1'));
    await same(() => data.updateContact(ann, ids[0], {}, 'u1'));
  });

  it('no such contact, a contact of another customer, no such customer: false from both', async () => {
    const [x, y] = [newId(), newId()];
    expect(await same(() => data.updateContact(ann, x, { name: 'x' }, 'u1'))).toBe(false);
    expect(await same(() => data.updateContact(bob, ids[0], { name: 'x' }, 'u1'))).toBe(false);
    expect(await same(() => data.updateContact(y, ids[0], { name: 'x' }, 'u1'))).toBe(false);
  });

  it('a list or object in a field, a sub-path of a text field, a bad id: refused by both', async () => {
    await bothRefuse(() => data.updateContact(ann, ids[0], { name: ['a'] }, 'u1'));
    await bothRefuse(() => data.updateContact(ann, ids[0], { phone: { a: 1 } }, 'u1'));
    await bothRefuse(() => data.updateContact(ann, ids[0], { 'name.x': 'y' }, 'u1'));
    await bothRefuse(() => data.updateContact('nope', ids[0], { name: 'x' }, 'u1'));
    await bothRefuse(() => data.updateContact(ann, 'nope', { name: 'x' }, 'u1'));
    await bothRefuse(() => data.updateContact(ann, ids[0], { _id: 'garbage' }, 'u1'));
  });

  it('a contact saved with an id on a customer that has id-less ones', async () => {
    expect(await same(() => data.updateContact(legacy, legacyContactId, { name: 'Has id, renamed' }, 'u1'))).toBe(true);
  });
});

describe('partners', () => {
  it('link both ways; linking twice changes nothing more', async () => {
    expect(await same(() => data.linkPartners(ann, bob))).toBe(true);
    expect(await same(() => data.linkPartners(ann, bob))).toBe(true);
    expect(await same(() => data.linkPartners(bob, ann))).toBe(true);
    await same(() => data.linkPartners(ann, cat));
    await same(() => data.linkPartners(ann, dan));
    await same(() => data.linkPartners(cat, dan));
  });

  it('to a customer that does not exist (deleted): false, nothing changed', async () => {
    const [x, y] = [newId(), newId()];
    expect(await same(() => data.linkPartners(ann, x))).toBe(false);
    expect(await same(() => data.linkPartners(y, ann))).toBe(false);
  });

  it('on a customer that still holds a link to a deleted one', async () => {
    expect(await same(() => data.linkPartners(legacy, eve))).toBe(true);
  });

  it('remove from the middle: both sides, the rest keep their order', async () => {
    await same(() => data.unlinkPartners(ann, cat));
    await same(() => data.unlinkPartners(ann, bob));
  });

  it('remove a link that is not there, one to a deleted customer, or twice', async () => {
    await same(() => data.unlinkPartners(ann, eve));
    await same(() => data.unlinkPartners(ann, cat));
    await same(() => data.unlinkPartners(legacy, gone));
    const [x, y] = [newId(), newId()];
    await same(() => data.unlinkPartners(x, y));
  });

  it('a malformed id is refused by both', async () => {
    await bothRefuse(() => data.linkPartners(ann, 'x'));
    await bothRefuse(() => data.unlinkPartners('x', ann));
  });
});

describe('password reset', () => {
  const shape = (r: unknown) => r && { ...(r as object) };

  it('a customer with a password, one without a login at all, and a locked one', async () => {
    await same(async () => shape(await data.resetCustomerPassword(ann, 'a-new-password')));
    await same(async () => shape(await data.resetCustomerPassword(plain, 'first-password')));
    await t.on('mongo', () => Customer.updateOne({ _id: locked }, { $set: { lockUntil: new Date('2026-11-10T17:45:00.000Z') } }));
    await t.resync();
    // The reset changes the password only: the lock stays until it runs out or they sign in.
    await same(async () => shape(await data.resetCustomerPassword(locked, 'after-lock-password')));
    const after = await t.on('postgres', async () => (await t.pg.db.execute(`select login_attempts, lock_until from customer_logins where customer_id = '${locked}'`)).rows[0]);
    expect(after).toMatchObject({ login_attempts: 4 });
    expect(after!.lock_until).not.toBeNull();
  });

  it('no such customer: null from both', async () => {
    const x = newId();
    expect(await same(() => data.resetCustomerPassword(x, 'whatever'))).toBeNull();
  });

  it('an old record that Mongoose would refuse is refused by both; one missing defaults gets them', async () => {
    await bothRefuse(() => data.resetCustomerPassword(old, 'x-password'));
    await bothRefuse(() => data.resetCustomerPassword('nope', 'x-password'));
  });

  it('a malformed id gives the same message', async () => {
    const m = await t.on('mongo', () => data.resetCustomerPassword('nope', 'x').catch((e: Error) => e.message));
    const p = await t.on('postgres', () => data.resetCustomerPassword('nope', 'x').catch((e: Error) => e.message));
    expect(p).toBe(m);
  });
});

describe('register', () => {
  const input = (over: Record<string, unknown> = {}) => ({ contactName: 'New Cust', email: 'fresh@shop.example', password: 'pw-12345', phone: '555', company: 'Shop', ...over });

  it('a new customer, with the id the caller made', async () => {
    const id = newId();
    const r = await same(async () => ({ ...(await data.registerCustomer(id, input()) as object) }));
    expect(r).toMatchObject({ _id: id });
  });

  it('the email is kept lowercase; without phone or company', async () => {
    const m1 = newId();
    await same(() => data.registerCustomer(m1, input({ email: 'Mixed.Case@Shop.example', phone: undefined, company: undefined })));
  });

  it('an email that is already registered, in any case: taken, nothing saved', async () => {
    const [r1, r2] = [newId(), newId()];
    expect(await same(() => data.registerCustomer(r1, input({ email: 'ann@acme.example' })))).toBe('taken');
    expect(await same(() => data.registerCustomer(r2, input({ email: 'ANN@ACME.EXAMPLE' })))).toBe('taken');
  });

  it('an empty password is hashed; a missing one, or a missing name or email, is refused by both', async () => {
    const p1 = newId();
    await same(() => data.registerCustomer(p1, input({ email: 'nopw@shop.example', password: '' })));
    await bothRefuse(() => data.registerCustomer(newId(), input({ email: 'nopw2@shop.example', password: undefined })));
    await bothRefuse(() => data.registerCustomer(newId(), input({ email: 'noname@shop.example', contactName: '' })));
    await bothRefuse(() => data.registerCustomer(newId(), input({ email: '' })));
  });
});

describe('website sign-in: attempts and the lock', () => {
  /** What the login route does for one attempt, and what it answers. */
  async function attempt(email: string, password: string, ip = '10.0.0.1') {
    const account = await data.findCustomerForSignIn(email);
    if (!account) return 'no account';
    if (account.isLocked()) return 'locked';
    if (!(await account.comparePassword(password))) { await account.incLoginAttempts(); return 'wrong'; }
    await data.recordCustomerSignIn(String(account._id), ip);
    return `ok ${account.contactName}`;
  }

  it('an unknown email', async () => {
    expect(await same(() => attempt('nobody@acme.example', PW))).toBe('no account');
  });

  it('wrong passwords count up to the lock, then even the right one is refused', async () => {
    const answers: string[] = [];
    for (let i = 0; i < 5; i++) answers.push(await same(() => attempt('ann@acme.example', 'wrong-one')) as string);
    expect(answers).toEqual(['wrong', 'wrong', 'wrong', 'wrong', 'wrong']);
    expect(await same(() => attempt('ann@acme.example', 'a-new-password'))).toBe('locked');
    expect(await same(() => attempt('ann@acme.example', 'wrong-one'))).toBe('locked');
  });

  it('after the lock runs out: a wrong password starts again at one, a right one signs in', async () => {
    expect(await same(() => attempt('ann@acme.example', 'wrong-one'), later(16))).toBe('wrong');
    expect(await same(() => attempt('ann@acme.example', 'a-new-password'), later(17))).toBe('ok Ann');
  });

  it('a right password clears the failed attempts; the last three addresses are kept', async () => {
    await same(() => attempt('lock@acme.example', 'wrong'));
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      expect(await same(() => attempt('lock@acme.example', 'after-lock-password', ip), later(30))).toBe('ok Lock');
    }
  });

  it('a customer with no password on record: both refuse the attempt', async () => {
    await bothRefuse(() => attempt('cat@acme.example', 'anything'));
  });

  it('a wrong password on a customer with no login row creates one with one failed attempt', async () => {
    const r = await data.findCustomerForSignIn('dan@acme.example');
    expect(r).not.toBeNull();
    await same(async () => { const a = await data.findCustomerForSignIn('dan@acme.example'); await a!.incLoginAttempts(); });
    await same(async () => { const a = await data.findCustomerForSignIn('dan@acme.example'); await a!.incLoginAttempts(); });
  });

  it('a signed-in customer is read back by id (/api/customer/me)', async () => {
    const pick = (a: Awaited<ReturnType<typeof data.customerAccount>>) => a && { id: String(a._id), contactName: a.contactName, email: a.email, company: a.company || '' };
    expect(await same(async () => pick(await data.customerAccount(ann)))).toMatchObject({ contactName: 'Ann' });
    const nobody = newId();
    expect(await same(async () => pick(await data.customerAccount(nobody)))).toBeNull();
    await bothRefuse(() => data.customerAccount('nope'));
  });
});

describe('geocoding job', () => {
  const geo = (status: string, extra: Record<string, unknown> = {}) => ({
    coordinates: { lat: null as number | null, lng: null as number | null },
    geocode: { status, precision: '', formattedAddress: '', addressKey: '', updatedAt: new Date('2026-11-10T17:31:00.000Z'), error: '', ...extra }
  });
  let a: string, b: string, c: string, d: string;

  beforeAll(async () => {
    [a, b, c, d] = [newId(), newId(), newId(), newId()];
    await t.on('mongo', () => Customer.insertMany([
      { _id: a, contactName: 'G1', email: 'g1@acme.example', location: 'Seattle', address: { street: '1 Pine St', city: 'Seattle', state: 'WA', zipCode: '98101' } },
      { _id: b, contactName: 'G2', email: 'g2@acme.example', location: 'Seattle', address: { street: 'kelvin fong' } },
      { _id: c, contactName: 'G3', email: 'g3@acme.example', location: 'Seattle', address: { street: '3 Oak Ave', city: 'Tacoma', state: 'WA' } },
      { _id: d, contactName: 'G4', email: 'g4@acme.example', location: 'Seattle', address: { city: 'Kent' },
        coordinates: { lat: 1, lng: 2 }, geocode: { status: 'ok', addressKey: 'kent', updatedAt: new Date('2026-10-01T00:00:00Z') } }
    ]));
    await t.resync();
  });

  const pickIds = (rows: Awaited<ReturnType<typeof data.customersToGeocode>>) =>
    rows.map(r => ({ id: String(r._id), street: r.address?.street ?? '', key: r.geocode?.addressKey ?? '' })).sort((x, y) => x.id.localeCompare(y.id));

  it('only those still waiting for a point, the rest left out', async () => {
    const nobody = newId();
    const r = await same(async () => pickIds(await data.customersToGeocode([a, b, c, d, nobody, 'junk', a])));
    expect(r.map(x => x.id).sort()).toEqual([a, b, c].sort());
  });

  it('a found point (ok), an address that cannot be found (failed), one we could not ask (pending)', async () => {
    await same(() => data.saveCustomerGeocode(a, {
      coordinates: { lat: 47.61, lng: -122.33 },
      geocode: { status: 'ok', precision: 'rooftop', formattedAddress: '1 Pine St, Seattle, WA 98101, USA', addressKey: '1 pine st, seattle, wa, 98101', updatedAt: new Date('2026-11-10T17:31:00.000Z'), error: '' }
    }));
    await same(() => data.saveCustomerGeocode(b, geo('failed', { error: 'no city or postcode — cannot place this address', addressKey: 'kelvin fong' })));
    await same(() => data.saveCustomerGeocode(c, geo('pending', { error: 'OVER_QUERY_LIMIT' })));
  });

  it('after a pending answer the customer is asked for again; a placed one is not', async () => {
    const r = await same(async () => pickIds(await data.customersToGeocode([a, b, c, d])));
    expect(r.map(x => x.id)).toEqual([c]);
  });

  it('a customer that is gone: nothing written', async () => {
    const nobody = newId();
    await same(() => data.saveCustomerGeocode(nobody, geo('pending')));
  });
});
