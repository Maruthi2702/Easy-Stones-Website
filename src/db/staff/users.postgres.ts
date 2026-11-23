/**
 * Staff accounts on Postgres, behaving as the Mongoose `User` model did.
 *
 * Reads answer MongoDB-shaped documents (`_id`, `password`, `location`, `assignedLocations`),
 * with the filter / select / sort / update the routes already use run in memory on the whole
 * (small) list — see mongoQuery.ts. A document you will change comes back as a `PgUser`: set
 * fields and call `save()`, as with Mongoose. Like Mongoose, `save()` writes only what changed
 * since the read, so a login attempt counted while an edit form was open isn't overwritten;
 * and it hashes a changed `password`. Every write takes one transaction-scoped lock, so a
 * read-then-write can't interleave with another.
 */
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { users, roles, locations, userLocations } from '../schema/reference.ts';
import { referenceRows } from '../copy/referenceRows.ts';
import { newId } from '../ids.ts';
import { assignedLocationsOf } from './staffDoc.ts';
import { matches, selectFields, sortDocs, applyUpdate } from './mongoQuery.ts';
import type { Loose } from '../../types/records.ts';

export const SECRET_FIELDS = ['calendarFeedKey', 'inviteTokenHash'];
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

type UserRow = typeof users.$inferSelect;
export interface ReadOptions { select?: string; sort?: Record<string, 1 | -1> }

/** The whole account as MongoDB held it (password hash and secrets included). */
function fullDoc(u: UserRow, homeName: string | null, assignedNames: string[]): Loose {
  const doc: Loose = {
    _id: u.id, username: u.username, displayName: u.displayName, password: u.passwordHash,
    email: u.email ?? undefined, phone: u.phone ?? undefined, role: u.role, loginAttempts: u.loginAttempts, lockUntil: u.lockUntil ?? undefined,
    isActive: u.isActive, deactivatedAt: u.deactivatedAt, deactivatedBy: u.deactivatedBy, joiningDate: u.joiningDate,
    mustChangePassword: u.mustChangePassword, tempPasswordExpiresAt: u.tempPasswordExpiresAt, sessionVersion: u.sessionVersion,
    inviteTokenHash: u.inviteTokenHash, inviteExpiresAt: u.inviteExpiresAt, editedBy: u.editedBy, editedAt: u.editedAt,
    lastSeenAt: u.lastSeenAt, lastLoginAt: u.lastLoginAt, location: homeName ?? undefined,
    assignedLocations: assignedLocationsOf(u.allLocations, assignedNames),
    googleAccessToken: u.googleAccessToken, calendarFeedKey: u.calendarFeedKey, googleRefreshToken: u.googleRefreshToken,
    googleEmail: u.googleEmail, googleCalendarSyncEnabled: u.googleCalendarSyncEnabled, icloudUsername: u.icloudUsername,
    icloudPassword: u.icloudPassword, icloudCalendarUrl: u.icloudCalendarUrl, icloudCalendarName: u.icloudCalendarName,
    icloudSyncEnabled: u.icloudSyncEnabled, routePlannerFilters: u.routePlannerFilters, pinnedTabs: u.pinnedTabs,
    createdAt: u.createdAt, updatedAt: u.updatedAt
  };
  return doc;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Db | Tx;

async function loadAll(db: Reader): Promise<Loose[]> {
  const rows = await db.select({
    user: users,
    homeName: locations.name,
    assigned: sql<string[]>`coalesce((select array_agg(l.name) from user_locations ul join locations l on l.id = ul.location_id where ul.user_id = ${users.id}), '{}')`
  }).from(users).leftJoin(locations, eq(locations.id, users.homeLocationId));
  return rows.map(r => fullDoc(r.user, r.homeName, r.assigned));
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
const lockUsers = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('staff_users'))`);

/** Write one whole account: the row and its assigned locations, built by the copy's own builder. */
async function writeUser(tx: Tx, doc: Loose): Promise<void> {
  const [locs, rls] = await Promise.all([
    tx.select({ id: locations.id, name: locations.name }).from(locations),
    tx.select({ id: roles.id, name: roles.name }).from(roles)
  ]);
  const problems: { reason: string; field: string }[] = [];
  const { rows } = referenceRows({
    locations: locs.map(l => ({ _id: l.id, name: l.name })), roles: rls.map(r => ({ _id: r.id, name: r.name })),
    users: [doc], visitTypes: [], resourceFamilies: [], resourceTypes: []
  }, problems as never);
  const row = rows.users[0];
  if (!row) throw new Error(`That account can’t be stored: ${problems.map(p => `${p.field} ${p.reason}`).join(', ') || 'missing details'}.`);
  const { id, createdAt: _c, ...columns } = row;
  await tx.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: columns });
  await tx.delete(userLocations).where(eq(userLocations.userId, id));
  const links = rows.userLocations.filter(l => l.userId === id);
  if (links.length) await tx.insert(userLocations).values(links);
}

/** The model's setters also run on a filter: `username` and `email` are trimmed and lower-cased. */
function castFilter(f: Loose): Loose {
  const out: Loose = {};
  for (const [k, v] of Object.entries(f)) {
    if ((k === 'username' || k === 'email') && typeof v === 'string') out[k] = v.trim().toLowerCase();
    else if ((k === '$or' || k === '$and') && Array.isArray(v)) out[k] = v.map(x => castFilter(x));
    else out[k] = v;
  }
  return out;
}

const present = (doc: Loose, o: ReadOptions) => selectFields(doc, o.select, SECRET_FIELDS);

// ── Plain reads ────────────────────────────────────────────────────────────

export async function findUsers(db: Db, filter: Loose = {}, o: ReadOptions = {}): Promise<Loose[]> {
  const f = castFilter(filter);
  const all = (await loadAll(db)).filter(d => matches(d, f));
  return sortDocs(all, o.sort).map(d => present(d, o));
}
export async function findUser(db: Db, filter: Loose, o: ReadOptions = {}): Promise<Loose | null> {
  return (await findUsers(db, filter, o))[0] ?? null;
}
export const userExists = async (db: Db, filter: Loose) => (await findUser(db, filter, { select: '_id' }))?._id ?? null;
export async function countUsers(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return r?.n ?? 0;
}

// ── Documents you change ───────────────────────────────────────────────────

const DEFAULTS = (): Loose => ({
  displayName: '', role: 'sales_rep', loginAttempts: 0, isActive: true, deactivatedAt: null, deactivatedBy: '',
  joiningDate: null, mustChangePassword: false, tempPasswordExpiresAt: null, sessionVersion: 0,
  inviteTokenHash: null, inviteExpiresAt: null, editedBy: '', editedAt: null, lastSeenAt: null, lastLoginAt: null,
  assignedLocations: ['Seattle'], googleAccessToken: null, calendarFeedKey: null, googleRefreshToken: null, googleEmail: null,
  googleCalendarSyncEnabled: false, icloudUsername: null, icloudPassword: null, icloudCalendarUrl: null,
  icloudCalendarName: null, icloudSyncEnabled: false, routePlannerFilters: {}, pinnedTabs: []
});

/** Mongoose's setters: usernames and emails are lower-cased, text trimmed. */
function tidy(doc: Loose): Loose {
  const out = { ...doc };
  if (typeof out.username === 'string') out.username = out.username.trim().toLowerCase();
  if (typeof out.email === 'string') out.email = out.email.trim().toLowerCase() || undefined;
  if (typeof out.displayName === 'string') out.displayName = out.displayName.trim();
  if (typeof out.phone === 'string') out.phone = out.phone.trim() || undefined;
  if (typeof out.location === 'string') out.location = out.location.trim() || undefined;
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A taken username or email is MongoDB's duplicate-key error (code 11000) to the routes that catch it. */
const duplicateAsMongo = (err: unknown): never => {
  const code = (err as Loose)?.cause?.code ?? (err as Loose)?.code;
  if (code === '23505') throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  throw err;
};

/** A loaded (or new) account: change fields, then `await doc.save()`. */
export class PgUser {
  [field: string]: unknown;
  constructor(fields: Loose, store: () => Promise<Db>, isNew = false) {
    Object.assign(this, fields);
    Object.defineProperty(this, 'store', { value: store, enumerable: false, writable: true });
    Object.defineProperty(this, '__snapshot', { value: isNew ? {} : structuredClone(fields), enumerable: false, writable: true });
    Object.defineProperty(this, '__isNew', { value: isNew, enumerable: false, writable: true });
  }
  get id() { return String(this._id); }
  toJSON(): Loose { return { ...(this as Loose) }; }
  isLocked(): boolean { return !!(this.lockUntil && (this.lockUntil as Date).getTime() > Date.now()); }
  comparePassword(candidate: string): Promise<boolean> { return bcrypt.compare(candidate, String(this.password)); }
  private db(): Promise<Db> { return ((this as Loose).store as () => Promise<Db>)(); }
  async incLoginAttempts() { return incLoginAttempts(await this.db(), String(this._id)); }
  async resetLoginAttempts() { return resetLoginAttempts(await this.db(), String(this._id)); }

  async save(): Promise<this> {
    const db = await this.db();
    const snap = (this as Loose).__snapshot as Loose;
    const mine = this.toJSON();
    const keys = new Set([...Object.keys(mine), ...Object.keys(snap)]);
    const changed: Loose = {};
    for (const k of keys) if (!same(mine[k], snap[k])) changed[k] = mine[k];
    const isNew = (this as Loose).__isNew as boolean;
    if (isNew) {
      if (!mine.username || !mine.password) throw new Error('User validation failed: username and password are required');
      if (String(mine.password).length < 6) throw new Error('User validation failed: password is shorter than the minimum allowed length (6)');
    }
    const saved = await db.transaction(async tx => {
      await lockUsers(tx);
      const now = new Date();
      let doc: Loose;
      if (isNew) {
        doc = { ...DEFAULTS(), ...mine, _id: isId(mine._id) ? mine._id : newId(), createdAt: now };
      } else {
        const current = (await loadAll(tx)).find(d => d._id === this._id);
        if (!current) throw new Error('That account no longer exists.');
        doc = { ...current };
        for (const [k, v] of Object.entries(changed)) { if (v === undefined) delete doc[k]; else doc[k] = v; }
      }
      if (isNew || 'password' in changed) doc.password = await bcrypt.hash(String(doc.password), await bcrypt.genSalt(10));
      doc = tidy(doc);
      doc.updatedAt = now;
      await writeUser(tx, doc);
      return doc;
    }).catch(duplicateAsMongo);
    Object.assign(this, saved);
    Object.defineProperty(this, '__snapshot', { value: structuredClone(this.toJSON()), enumerable: false, writable: true });
    Object.defineProperty(this, '__isNew', { value: false, enumerable: false, writable: true });
    return this;
  }
}

export async function userDoc(db: Db, filter: Loose, o: ReadOptions = {}): Promise<PgUser | null> {
  const found = await findUser(db, filter, o);
  return found ? new PgUser(found, async () => db) : null;
}
export const newUserDoc = (db: Db, fields: Loose): PgUser => new PgUser(tidy({ ...DEFAULTS(), ...fields }), async () => db, true);

// ── Atomic writes ──────────────────────────────────────────────────────────

/** MongoDB's updateOne: the first account matching the filter gets the update. */
export async function updateUser(db: Db, filter: Loose, update: Loose): Promise<{ matchedCount: number; modifiedCount: number }> {
  return db.transaction(async tx => {
    await lockUsers(tx);
    const f = castFilter(filter);
    const doc = (await loadAll(tx)).find(d => matches(d, f));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    const next = tidy({ ...applyUpdate(doc, update), updatedAt: new Date() });
    const changed = !same({ ...doc, updatedAt: 0 }, { ...next, updatedAt: 0 });
    if (changed) await writeUser(tx, next);
    return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
  });
}

/** findOneAndUpdate({ new: true }): the account after the update, or null. */
export async function findUserAndUpdate(db: Db, filter: Loose, update: Loose, o: ReadOptions = {}): Promise<Loose | null> {
  return db.transaction(async tx => {
    await lockUsers(tx);
    const f = castFilter(filter);
    const doc = (await loadAll(tx)).find(d => matches(d, f));
    if (!doc) return null;
    const next = tidy({ ...applyUpdate(doc, update), updatedAt: new Date() });
    await writeUser(tx, next);
    return present(next, o);
  });
}

/** True when an account was removed. */
export async function deleteUser(db: Db, id: string): Promise<boolean> {
  if (!isId(id)) return false;
  return db.transaction(async tx => {
    await lockUsers(tx);
    const gone = await tx.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return gone.length > 0;
  });
}

/** Count a wrong password; five lock the account for 15 minutes (the model's rule, one statement). */
export async function incLoginAttempts(db: Db, id: string, now = new Date()): Promise<void> {
  const end = new Date(now.getTime() + LOCK_MINUTES * 60_000);
  await db.transaction(async tx => {
    await lockUsers(tx);
    await tx.update(users).set({
      loginAttempts: sql`case when ${users.lockUntil} is not null and ${users.lockUntil} < ${now} then 1 else ${users.loginAttempts} + 1 end`,
      lockUntil: sql`case when ${users.lockUntil} is not null and ${users.lockUntil} < ${now} then null
        when ${users.loginAttempts} + 1 >= ${MAX_LOGIN_ATTEMPTS} and (${users.lockUntil} is null or ${users.lockUntil} <= ${now}) then ${end}
        else ${users.lockUntil} end`,
      updatedAt: now
    }).where(eq(users.id, id));
  });
}
export async function resetLoginAttempts(db: Db, id: string): Promise<void> {
  await db.transaction(async tx => {
    await lockUsers(tx);
    await tx.update(users).set({ loginAttempts: 0, lockUntil: null, updatedAt: new Date() }).where(eq(users.id, id));
  });
}
/** Online tracking: the last time they used the app. */
export async function touchLastSeen(db: Db, id: string, at: Date): Promise<void> {
  if (!isId(id)) return;
  await db.transaction(async tx => {
    await lockUsers(tx);
    await tx.update(users).set({ lastSeenAt: at }).where(eq(users.id, id));
  });
}
