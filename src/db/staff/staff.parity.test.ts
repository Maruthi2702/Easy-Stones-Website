/**
 * Sign-in identity and roles, read from MongoDB and from Postgres (a copy of the same seed):
 * every question must get the same answer. The only declared difference is the order of a
 * person's assigned locations (staffDoc.ts), so those are compared sorted.
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import User from '../../models/User.ts';
import Role from '../../models/Role.ts';
import Location from '../../models/Location.ts';
import {
  authIdentity, roleByName, rolesList, locationsList, locationNames, locationByName, locationById,
  createLocation, updateLocation, deleteLocation, locationByNameAnyCase, setDeliveryColumns
} from './index.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
// A new row's id is made by the data layer: both runs of one request must get the same one.
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

let t: WriteParity;
const id: Record<string, string> = {};

beforeAll(async () => {
  t = await openWriteParity(async () => {
    const seattle = await Location.create({ name: 'Seattle', shortCode: 'SEA' });
    await Location.create({ name: 'Kent', shortCode: 'KNT' });
    await Location.create({ name: 'Portland', shortCode: 'PDX' });
    await Role.create({ name: 'sales_rep', displayName: 'Sales Rep', permissions: ['view_customers', 'view_dashboard'] });
    await Role.create({ name: 'admin', displayName: 'Admin', permissions: ['manage_users'], isSystem: true, manageableRoles: ['sales_rep'] });
    const mk = async (key: string, over: Loose) => { id[key] = String((await User.create({ password: 'secret-pass', ...over }))._id); };
    await mk('rep', { username: 'Dee', displayName: 'Dee R', email: 'Dee@Example.com', role: 'sales_rep', location: seattle.name, assignedLocations: ['Seattle', 'Kent'], pinnedTabs: ['customers'], routePlannerFilters: { unassigned: true } });
    await mk('all', { username: 'root', role: 'admin', assignedLocations: ['*'], mustChangePassword: true, sessionVersion: 3 });
    await mk('none', { username: 'nolocation', role: 'sales_rep', assignedLocations: [] });
    await mk('off', { username: 'gone', role: 'sales_rep', isActive: false, location: 'Kent', assignedLocations: ['Kent', 'Seattle', 'Portland'] });
  }, 'DB_STAFF');
}, 240000);

afterAll(async () => { await t?.close(); });

const sortedLocations = (d: Loose | null) => d && { ...d, assignedLocations: [...(d.assignedLocations || [])].sort() };
const both = async <T>(run: () => Promise<T>) => { ids.made.length = 0; return t.both(async () => { ids.used = 0; return run(); }); };

describe('sign-in identity', () => {
  for (const key of ['rep', 'all', 'none', 'off']) {
    it(`answers the same for the ${key} account`, async () => {
      const { mongo, postgres } = await both(() => authIdentity(id[key]));
      expect(mongo).not.toBeNull();
      expect(normalize(sortedLocations(postgres))).toEqual(normalize(sortedLocations(mongo)));
    });
  }

  it('has no password and no tokens in what it sends', async () => {
    for (const db of ['mongo', 'postgres'] as const) {
      const doc = await t.on(db, () => authIdentity(id.rep));
      expect(Object.keys(doc!)).not.toContain('password');
      expect(Object.keys(doc!)).not.toContain('googleAccessToken');
      expect(Object.keys(doc!)).not.toContain('calendarFeedKey');
    }
  });

  it('finds nobody for an unknown or malformed id, on both', async () => {
    const { mongo, postgres } = await both(() => authIdentity(new mongoose.Types.ObjectId().toHexString()));
    expect(mongo).toBeNull();
    expect(postgres).toBeNull();
    expect(await t.on('postgres', () => authIdentity('nope'))).toBeNull();
  });
});

describe('roles', () => {
  it('reads one by name, with its name trimmed and lower-cased', async () => {
    const { mongo, postgres } = await both(() => roleByName(' Admin '));
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect((mongo as Loose).manageableRoles).toEqual(['sales_rep']);
    const none = await both(() => roleByName('missing'));
    expect(none.mongo).toBeNull();
    expect(none.postgres).toBeNull();
  });

  it('lists them A–Z', async () => {
    const { mongo, postgres } = await both(() => rolesList());
    expect(normalize(postgres)).toEqual(normalize(mongo));
    expect(mongo.map(r => r.name)).toEqual(['admin', 'sales_rep']);
  });
});

describe('locations', () => {
  const geocode = async (doc: Loose) => {
    doc.coordinates = { lat: 47.6, lng: -122.3 };
    doc.geocode = { status: 'ok', precision: 'exact', formattedAddress: '1 Main', addressKey: 'k1', updatedAt: new Date('2026-11-10T17:30:00Z'), error: '' };
  };
  const fresh = {
    name: 'Spokane', shortCode: 'SPK', fullName: 'Easy Stones - Spokane', region: 'West', rdc: 'Seattle', warehouse: true,
    primaryContact: { name: 'Pat', email: 'pat@x.com', phone: '555', address: { street: '1 Main', city: 'Spokane', state: 'WA', zipCode: '99201' } },
    salesDefaults: { salesRep: 'Dee R', priceLevel: 2, paymentTerms: 'C.O.D', salesTaxRate: 8.9 },
    costOverrides: { avgUnitFreight: 12.5 }, dailyReportEmail: { userIds: [] as string[], extraEmails: ['a@x.com'] }
  };
  const strip = (d: Loose | null) => d && normalize({ ...d, __v: undefined });

  it('lists and finds them the same', async () => {
    const list = await both(() => locationsList());
    expect(normalize(list.postgres)).toEqual(normalize(list.mongo));
    expect(list.mongo.map(l => l.name)).toEqual(['Kent', 'Portland', 'Seattle']);
    expect((await both(() => locationNames())).postgres).toEqual(['Kent', 'Portland', 'Seattle']);
    const one = await both(() => locationByName('Seattle'));
    expect(normalize(one.postgres)).toEqual(normalize(one.mongo));
    id.seattle = String(one.mongo!._id);
    const byId = await both(() => locationById(id.seattle));
    expect(normalize(byId.postgres)).toEqual(normalize(byId.mongo));
    expect((await both(() => locationById('nope'))).postgres).toBeNull();
  });

  it('creates one, geocoded, with a recipient and leaves both databases equal', async () => {
    const body = { ...fresh, dailyReportEmail: { userIds: [id.rep, new mongoose.Types.ObjectId().toHexString()], extraEmails: ['a@x.com'] } };
    const made = await both(() => createLocation(body, 'root', geocode));
        expect(made.mongo.ok && made.postgres.ok).toBe(true);
    expect(await t.differences()).toEqual([]);
    const stored = await both(() => locationByName('Spokane'));
    // A recipient who isn't a user is kept by MongoDB and dropped by Postgres, as the copy does (README).
    expect(stored.mongo!.dailyReportEmail.userIds).toHaveLength(2);
    expect(stored.postgres!.dailyReportEmail.userIds).toEqual([id.rep]);
    const bare = (d: Loose | null) => strip({ ...d, dailyReportEmail: { ...d!.dailyReportEmail, userIds: [] } });
    expect(bare(stored.postgres)).toEqual(bare(stored.mongo));
  });

  it('refuses a second location with the same name on both', async () => {
    const again = await both(() => createLocation(fresh, 'root', geocode));
    expect(again.mongo).toEqual({ ok: false, duplicate: true });
    expect(again.postgres).toEqual({ ok: false, duplicate: true });
  });

  it('edits one: each key sent replaces what was there, equal afterwards', async () => {
    const spokane = (await t.on('mongo', () => locationByName('Spokane')))!;
    const sid = String(spokane._id);
    const patch = { fullName: 'Easy Stones Spokane', primaryContact: { phone: '999', address: { street: '1 Main', city: 'Liberty Lake' } }, salesDefaults: { priceLevel: 3 } };
    const r = await both(() => updateLocation(sid, patch, 'dee', geocode));
    expect(r.mongo!.primaryContact.address.street).toBe('1 Main');
    expect(r.postgres!.primaryContact.address.street).toBe('1 Main');
    expect(await t.differences()).toEqual([]);
    expect((await both(() => updateLocation(new mongoose.Types.ObjectId().toHexString(), patch, 'dee', geocode))).postgres).toBeNull();
  });

  it('deletes one and clears the RDC that named it', async () => {
    const seattle = String((await t.on('mongo', () => locationByName('Seattle')))!._id);
    const gone = await both(() => deleteLocation(seattle));
    expect(gone).toEqual({ mongo: true, postgres: true });
    expect((await both(() => locationByName('Spokane'))).postgres!.rdc).toBe('');
    expect((await both(() => deleteLocation(seattle))).postgres).toBe(false);
    expect(await t.differences()).toEqual([]);
  });
});

describe('location look-ups the other screens use', () => {
  it('finds a name in any case, and saves a delivery column order', async () => {
    const found = await both(() => locationByNameAnyCase('kENT'));
    expect(found.mongo!.name).toBe('Kent');
    expect(found.postgres!.name).toBe('Kent');
    expect((await both(() => locationByNameAnyCase('nowhere'))).postgres).toBeNull();
    const set = await both(() => setDeliveryColumns('Kent', ['drv_dee', '__will_call__']));
    expect(set.postgres).toEqual(set.mongo);
    expect((await both(() => setDeliveryColumns('nowhere', ['x']))).postgres).toBeNull();
    expect(await t.differences()).toEqual([]);
  });
});
