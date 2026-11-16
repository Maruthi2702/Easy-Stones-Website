/**
 * Roles on Postgres, behaving as the Mongoose `Role` model did (users.postgres.ts explains the
 * shape): MongoDB-shaped documents, the routes' own filters run in memory, and a `PgRole` whose
 * `save()` writes only what changed. Names are trimmed and lower-cased, as the model's setters did.
 */
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { roles } from '../schema/reference.ts';
import { referenceRows } from '../copy/referenceRows.ts';
import { newId } from '../ids.ts';
import { roleDoc } from './staffDoc.ts';
import { matches, selectFields, sortDocs } from './mongoQuery.ts';
import type { Loose } from '../../types/records.ts';
import type { ReadOptions } from './users.postgres.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/.test(v);
const lockRoles = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('staff_roles'))`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const loadAll = async (db: Db | Tx): Promise<Loose[]> => (await db.select().from(roles)).map(roleDoc);

/** The model's name setter also applies to a filter's `name`. */
const castFilter = (f: Loose): Loose =>
  typeof f.name === 'string' ? { ...f, name: f.name.trim().toLowerCase() } : f;

const DEFAULTS = (): Loose => ({ permissions: [], seededPermissions: [], manageableRoles: [], approvesCardReceiptsOf: [], isSystem: false });

async function writeRole(tx: Tx, doc: Loose): Promise<void> {
  const { rows } = referenceRows({ locations: [], roles: [doc], users: [], visitTypes: [], resourceFamilies: [], resourceTypes: [] }, []);
  const row = rows.roles[0];
  if (!row) throw new Error('That role can’t be stored: it needs a name.');
  const { id: _id, createdAt: _c, ...columns } = row;
  await tx.insert(roles).values(row).onConflictDoUpdate({ target: roles.id, set: columns });
}

export async function findRoles(db: Db, filter: Loose = {}, o: ReadOptions = {}): Promise<Loose[]> {
  const f = castFilter(filter);
  return sortDocs((await loadAll(db)).filter(d => matches(d, f)), o.sort).map(d => selectFields(d, o.select));
}
export async function findRole(db: Db, filter: Loose, o: ReadOptions = {}): Promise<Loose | null> {
  return (await findRoles(db, filter, o))[0] ?? null;
}
export const roleExists = async (db: Db, filter: Loose) => (await findRole(db, filter, { select: '_id' }))?._id ?? null;

export class PgRole {
  [field: string]: unknown;
  constructor(fields: Loose, store: () => Promise<Db>, isNew = false) {
    Object.assign(this, fields);
    Object.defineProperty(this, 'store', { value: store, enumerable: false, writable: true });
    Object.defineProperty(this, '__snapshot', { value: isNew ? {} : structuredClone(fields), enumerable: false, writable: true });
    Object.defineProperty(this, '__isNew', { value: isNew, enumerable: false, writable: true });
  }
  get id() { return String(this._id); }
  toJSON(): Loose { return { ...(this as Loose) }; }

  async save(): Promise<this> {
    const db = await ((this as Loose).store as () => Promise<Db>)();
    const snap = (this as Loose).__snapshot as Loose;
    const mine = this.toJSON();
    const changed: Loose = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(snap)])) if (!same(mine[k], snap[k])) changed[k] = mine[k];
    const isNew = (this as Loose).__isNew as boolean;
    if (isNew && (!mine.name || !mine.displayName)) throw new Error('Role validation failed: name and displayName are required');
    const saved = await db.transaction(async tx => {
      await lockRoles(tx);
      const now = new Date();
      let doc: Loose;
      if (isNew) doc = { ...DEFAULTS(), ...mine, _id: isId(mine._id) ? mine._id : newId(), createdAt: now };
      else {
        const current = (await loadAll(tx)).find(d => d._id === this._id);
        if (!current) throw new Error('That role no longer exists.');
        doc = { ...current };
        for (const [k, v] of Object.entries(changed)) { if (v === undefined) delete doc[k]; else doc[k] = v; }
      }
      if (typeof doc.name === 'string') doc.name = doc.name.trim().toLowerCase();
      if (typeof doc.displayName === 'string') doc.displayName = doc.displayName.trim();
      doc.updatedAt = now;
      await writeRole(tx, doc);
      return doc;
    });
    Object.assign(this, saved);
    Object.defineProperty(this, '__snapshot', { value: structuredClone(this.toJSON()), enumerable: false, writable: true });
    Object.defineProperty(this, '__isNew', { value: false, enumerable: false, writable: true });
    return this;
  }
}

export async function roleDocFor(db: Db, filter: Loose): Promise<PgRole | null> {
  const found = await findRole(db, filter);
  return found ? new PgRole(found, async () => db) : null;
}
export const newRoleDoc = (db: Db, fields: Loose): PgRole => new PgRole({ ...DEFAULTS(), ...fields }, async () => db, true);

export async function deleteRole(db: Db, id: string): Promise<boolean> {
  if (!isId(id)) return false;
  return (await db.delete(roles).where(eq(roles.id, id)).returning({ id: roles.id })).length > 0;
}

export async function roleDocsFor(db: Db, filter: Loose = {}): Promise<PgRole[]> {
  return (await findRoles(db, filter)).map(f => new PgRole(f, async () => db));
}
