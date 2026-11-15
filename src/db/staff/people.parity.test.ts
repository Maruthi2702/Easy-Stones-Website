/**
 * Users and roles through the staff layer: each question and each write run on MongoDB, then on
 * Postgres (a copy of the same seed), must answer the same and leave the same data behind
 * (the copy's own check, `t.differences()`, is the spec for what Postgres may hold).
 */
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { openWriteParity, type WriteParity } from '../customers/writes/writeParity.ts';
import { normalize } from '../customers/parity.ts';
import User from '../../models/User.ts';
import Role from '../../models/Role.ts';
import Location from '../../models/Location.ts';
import * as staff from './index.ts';
import type { Loose } from '../../types/records.ts';

vi.setConfig({ testTimeout: 90_000 });

// A hash that is the same on both databases, so the copy's check can compare it.
vi.mock('bcryptjs', () => {
  const api = {
    genSalt: async () => 'salt',
    hash: async (pw: string) => `hashed:${pw}`,
    compare: async (pw: string, h: string) => h === `hashed:${pw}`
  };
  return { default: api, ...api };
});

const ids = vi.hoisted(() => ({ made: [] as string[], used: 0 }));
vi.mock('../ids.ts', async original => {
  const real = await original<typeof import('../ids.ts')>();
  return { ...real, newId: () => { ids.made[ids.used] ??= real.newId(); return ids.made[ids.used++]; } };
});

let t: WriteParity;
const id: Record<string, string> = {};
const NOW = new Date('2026-11-10T17:30:00.000Z');

beforeAll(async () => {
  t = await openWriteParity(async () => {
    await Location.create({ name: 'Seattle', shortCode: 'SEA' });
    await Location.create({ name: 'Kent', shortCode: 'KNT' });
    await Role.create({ name: 'sales_rep', displayName: 'Sales Rep', permissions: ['view_customers'] });
    await Role.create({ name: 'driver', displayName: 'Driver', permissions: ['delivery_driver_view'] });
    await Role.create({ name: 'admin', displayName: 'Admin', permissions: ['manage_users'], isSystem: true });
    const mk = async (key: string, over: Loose) => { id[key] = String((await User.create({ password: 'secret-pass', ...over }))._id); };
    await mk('dee', { username: 'dee', displayName: 'Dee R', email: 'dee@x.com', role: 'sales_rep', location: 'Seattle', assignedLocations: ['Seattle', 'Kent'], pinnedTabs: ['customers'] });
    await mk('root', { username: 'root', role: 'admin', assignedLocations: ['*'] });
    await mk('sam', { username: 'sam', displayName: 'Sam Driver', role: 'driver', location: 'Kent', assignedLocations: ['Kent'], isActive: false });
  }, 'DB_STAFF');
}, 240000);
afterAll(async () => { await t?.close(); });

const both = async <T>(run: () => Promise<T>) => { ids.made.length = 0; return t.both(async () => { ids.used = 0; return run(); }, NOW); };
const sameAnswer = (r: { mongo: unknown; postgres: unknown }) => expect(normalize(r.postgres)).toEqual(normalize(r.mongo));
const plain = (d: Loose | null) => d && JSON.parse(JSON.stringify({ ...d, assignedLocations: [...(d.assignedLocations || [])].sort() }));

describe('reading users', () => {
  it('lists with a select, a sort and the filters the screens use', async () => {
    const byName = await both(async () => (await staff.findUsers({}, { select: 'username displayName', sort: { username: 1 } })));
    sameAnswer({ mongo: byName.mongo.map(plain), postgres: byName.postgres.map(plain) });
    expect(byName.mongo.map(u => u.username)).toEqual(['dee', 'root', 'sam']);

    const q = async (filter: Loose, select = 'username') => (await staff.findUsers(filter, { select, sort: { username: 1 } })).map(u => u.username);
    for (const filter of [
      { role: { $in: ['driver', 'admin'] } }, { isActive: { $ne: false } }, { assignedLocations: 'Kent' },
      { email: /^DEE@x\.com$/i }, { $or: [{ username: 'sam' }, { username: 'root' }] }, { _id: { $ne: new mongoose.Types.ObjectId(id.dee) } }
    ]) {
      const r = await both(() => q(filter));
      expect(r.postgres, JSON.stringify(filter)).toEqual(r.mongo);
    }
  });

  it('keeps the password and the secrets out unless asked', async () => {
    for (const db of ['mongo', 'postgres'] as const) {
      const plainDoc = await t.on(db, () => staff.userById(id.dee, { select: '-password' }));
      expect(plainDoc!.password).toBeUndefined();
      expect(plainDoc!.calendarFeedKey).toBeUndefined();
      const withKey = await t.on(db, () => staff.userById(id.dee, { select: 'isActive +calendarFeedKey' }));
      expect(Object.keys(withKey!).sort()).toEqual(['_id', 'isActive'].concat('calendarFeedKey' in withKey! ? ['calendarFeedKey'] : []).sort());
    }
  });

  it('finds one, says whether one exists and counts', async () => {
    sameAnswer(await both(async () => plain(await staff.findUser({ username: 'dee' }, { select: 'username role location assignedLocations' }))));
    expect((await both(async () => !!(await staff.userExists({ username: 'dee' })))).postgres).toBe(true);
    expect((await both(async () => !!(await staff.userExists({ username: 'nobody' })))).postgres).toBe(false);
    expect(await both(() => staff.countUsers())).toEqual({ mongo: 3, postgres: 3 });
  });
});

describe('saving users', () => {
  it('changes a document and saves only what changed, hashing a new password', async () => {
    const r = await both(async () => {
      const u = (await staff.userDocById(id.dee))!;
      expect(await u.comparePassword('secret-pass')).toBe(true);
      u.displayName = 'Dee Rivera'; u.assignedLocations = ['Kent']; u.location = 'Kent'; u.password = 'brand-new-pass'; u.sessionVersion = 1;
      await u.save();
      return plain(await staff.findUser({ _id: id.dee }, { select: 'displayName assignedLocations location sessionVersion' }));
    });
    sameAnswer(r);
    expect(await t.differences()).toEqual([]);
    expect(await t.on('postgres', async () => (await staff.userDocById(id.dee))!.comparePassword('brand-new-pass'))).toBe(true);
  });

  it('does not overwrite what changed after it was read', async () => {
    const r = await both(async () => {
      const u = (await staff.userDocById(id.root))!;
      await staff.updateUserById(id.root, { $set: { loginAttempts: 3 } });   // someone else, meanwhile
      u.displayName = 'Root Admin';
      await u.save();
      return plain(await staff.findUser({ _id: id.root }, { select: 'displayName loginAttempts' }));
    });
    sameAnswer(r);
    expect(r.postgres).toMatchObject({ displayName: 'Root Admin', loginAttempts: 3 });
    expect(await t.differences()).toEqual([]);
  });

  it('creates an account with the model’s defaults, tidy username and email', async () => {
    const r = await both(async () => {
      const u = await staff.newUserDoc({ username: '  New.Hire ', email: ' New@X.com ', password: 'first-pass', role: 'sales_rep', assignedLocations: ['Seattle'], location: 'Seattle' });
      await u.save();
      id.hire = String(u._id);
      return plain(await staff.findUser({ username: 'new.hire' }, { select: '-password' }));
    });
    expect(r.mongo!.username).toBe('new.hire');
    expect(r.mongo!.email).toBe('new@x.com');
    sameAnswer({ mongo: { ...r.mongo, _id: 0 }, postgres: { ...r.postgres, _id: 0 } });
    expect(await t.differences()).toEqual([]);
    await expect(t.on('postgres', async () => (await staff.newUserDoc({ username: 'short', password: '123' })).save())).rejects.toThrow(/password/);
  });

  it('applies updateOne and findOneAndUpdate operators', async () => {
    const r = await both(async () => {
      const a = await staff.updateUserById(id.sam, { $set: { isActive: true, lastSeenAt: NOW }, $unset: { deactivatedBy: 1 } });
      const b = await staff.updateUser({ username: 'nobody' }, { $set: { isActive: false } });
      const c = await staff.findUserAndUpdate({ _id: id.dee, calendarFeedKey: null }, { $set: { calendarFeedKey: 'seed-1' } }, { select: '+calendarFeedKey' });
      const d = await staff.findUserAndUpdate({ _id: id.dee, calendarFeedKey: null }, { $set: { calendarFeedKey: 'seed-2' } }, { select: '+calendarFeedKey' });
      return { a: a.matchedCount, b: b.matchedCount, c: c?.calendarFeedKey, d };
    });
    expect(r.mongo).toEqual({ a: 1, b: 0, c: 'seed-1', d: null });
    expect(r.postgres).toEqual(r.mongo);
    expect(await t.differences()).toEqual([]);
  });

  it('deletes one', async () => {
    expect(await both(() => staff.deleteUser(id.hire))).toEqual({ mongo: true, postgres: true });
    expect(await both(() => staff.deleteUser(id.hire))).toEqual({ mongo: false, postgres: false });
    expect(await t.differences()).toEqual([]);
  });
});

describe('sign-in counting', () => {
  const state = async () => plain(await staff.findUser({ _id: id.sam }, { select: 'loginAttempts lockUntil' }));

  it('locks at the fifth wrong password, for 15 minutes, and a reset clears it', async () => {
    const r = await both(async () => {
      const seen: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const u = (await staff.userDocById(id.sam))!;
        seen.push(u.isLocked());
        await u.incLoginAttempts();
      }
      seen.push(await state());
      const locked = (await staff.userDocById(id.sam))!;
      seen.push(locked.isLocked());
      await locked.resetLoginAttempts();
      seen.push(await state());
      return seen;
    });
    expect(r.postgres).toEqual(r.mongo);
    expect((r.mongo[5] as Loose).loginAttempts).toBe(5);
    expect(r.mongo[6]).toBe(true);
    expect((r.mongo[7] as Loose).loginAttempts).toBe(0);
    expect(await t.differences()).toEqual([]);
  });

  it('restarts the count once an old lock has run out', async () => {
    const expired = new Date(NOW.getTime() - 60_000);
    await t.on('mongo', () => staff.updateUserById(id.sam, { $set: { loginAttempts: 5, lockUntil: expired } }));
    await t.on('postgres', () => staff.updateUserById(id.sam, { $set: { loginAttempts: 5, lockUntil: expired } }));
    const r = await both(async () => { await (await staff.userDocById(id.sam))!.incLoginAttempts(); return state(); });
    expect(r.mongo).toMatchObject({ loginAttempts: 1 });
    expect(r.mongo!.lockUntil).toBeUndefined();
    expect(r.postgres).toEqual(r.mongo);
  });

  it('records the last time someone was seen', async () => {
    await both(() => staff.touchLastSeen(id.dee, NOW));
    expect(await t.differences()).toEqual([]);
  });
});

describe('roles', () => {
  it('reads with the name set by the model’s own rules', async () => {
    sameAnswer(await both(async () => (await staff.findRole({ name: ' DRIVER ' }, { select: 'name permissions' }))));
    sameAnswer(await both(async () => (await staff.findRoles({ permissions: 'delivery_driver_view' }, { select: 'name' }))));
    expect(await both(async () => !!(await staff.roleExists({ name: 'nope' })))).toEqual({ mongo: false, postgres: false });
  });

  it('creates, edits in place and deletes one', async () => {
    const r = await both(async () => {
      const role = await staff.newRoleDoc({ name: 'Sales Lead', displayName: 'Sales Lead', permissions: ['view_customers'] });
      await role.save();
      id.lead = String(role._id);
      const again = (await staff.roleDocById(id.lead))!;
      again.permissions.push('view_dashboard');          // in place, as the boot-time grants do
      again.seededPermissions = ['view_dashboard'];
      await again.save();
      return plain(await staff.findRole({ _id: id.lead }, { select: 'name permissions seededPermissions' }));
    });
    expect((r.mongo as Loose).permissions).toEqual(['view_customers', 'view_dashboard']);
    sameAnswer({ mongo: { ...r.mongo, _id: 0 }, postgres: { ...r.postgres, _id: 0 } });
    expect(await t.differences()).toEqual([]);
    expect(await both(() => staff.deleteRole(id.lead))).toEqual({ mongo: true, postgres: true });
    expect(await t.differences()).toEqual([]);
  });
});
