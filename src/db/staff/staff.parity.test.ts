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
import { authIdentity, roleByName, rolesList } from './index.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

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
  });
}, 240000);

afterAll(async () => { await t?.close(); });

const sortedLocations = (d: Loose | null) => d && { ...d, assignedLocations: [...(d.assignedLocations || [])].sort() };
const both = async <T>(run: () => Promise<T>) => { const r = await t.both(run); return r; };

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
