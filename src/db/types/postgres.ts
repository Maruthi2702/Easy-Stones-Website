/**
 * The type lists on Postgres, answering and saving in MongoDB's shape. A save builds the record as
 * MongoDB would hold it, then makes the row with the copy's own builder (`referenceRows`), so it writes
 * what a re-copy would. Deleting a type records use moves them and deletes it in ONE transaction, using the
 * customer area's own Postgres functions (src/db/customers/writes/resources.postgres.ts) on that transaction.
 */
import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { visitTypes, resourceTypes, resourceFamilies } from '../schema/reference.ts';
import { referenceRows } from '../copy/referenceRows.ts';
import * as customers from '../customers/writes/resources.postgres.ts';
import { familyLookup } from '../../utils/modaTotals.ts';
import type { Loose } from '../../types/records.ts';
import type { TypeKind, TypeStore, RemoveResult } from './store.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);
const lockTypes = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('type_lists'))`);

const TABLE = { visit: visitTypes, resource: resourceTypes, family: resourceFamilies } as const;
const KEY = { visit: 'visitTypes', resource: 'resourceTypes', family: 'resourceFamilies' } as const;

/** A row → the record MongoDB held. */
function docOf(kind: TypeKind, r: Loose): Loose {
  const base = { _id: r.id, name: r.name, label: r.label, order: r.sortOrder, active: r.active, updatedBy: r.updatedBy, createdAt: r.createdAt, updatedAt: r.updatedAt };
  if (kind === 'visit') return { ...base, system: r.system, fields: { notes: r.usesNotes, outcome: r.usesOutcome, followUp: r.followUp } };
  if (kind === 'resource') return { ...base, family: r.family };
  return { ...base, system: r.system };
}

async function all(db: Db | Tx, kind: TypeKind): Promise<Loose[]> {
  const t = TABLE[kind] as never as typeof visitTypes;
  const rows = await db.select().from(t).orderBy(asc(t.sortOrder), asc(t.createdAt)) as Loose[];
  return rows.map(r => docOf(kind, r));
}

/** The row for a whole record, made by the copy's builder (a resource type needs the families beside it). */
async function rowOf(db: Db | Tx, kind: TypeKind, doc: Loose): Promise<Loose> {
  const src = { locations: [], roles: [], users: [], visitTypes: [], resourceFamilies: [] as Loose[], resourceTypes: [] as Loose[] };
  if (kind === 'resource') src.resourceFamilies = (await db.select({ _id: resourceFamilies.id, name: resourceFamilies.name, label: resourceFamilies.label }).from(resourceFamilies));
  (src as Loose)[KEY[kind]] = [...((src as Loose)[KEY[kind]] as Loose[]), doc];
  const { rows } = referenceRows(src as never, []);
  const row = (rows as Loose)[KEY[kind]].find((r: Loose) => r.id === doc._id);
  if (!row) throw new Error(kind === 'resource' ? 'That resource type can’t be stored: its family isn’t on the list.' : 'That record can’t be stored.');
  return row;
}

async function save(tx: Tx, kind: TypeKind, doc: Loose, insert: boolean): Promise<void> {
  const row = await rowOf(tx, kind, doc);
  const t = TABLE[kind] as never as typeof visitTypes;
  if (insert) await tx.insert(t).values(row as never);
  else {
    const { id: _id, createdAt: _c, ...columns } = row;
    await tx.update(t).set(columns as never).where(eq(t.id, doc._id));
  }
}

const familyRows = (db: Db | Tx) => db.select({ name: resourceTypes.name, family: resourceTypes.family }).from(resourceTypes);

export function pgTypeStore(db: Db, kind: TypeKind): TypeStore {
  const t = TABLE[kind] as never as typeof visitTypes;

  const countUses = async (d: Db | Tx, name: string): Promise<number> => {
    if (kind === 'visit') return customers.countVisitTypeUses(d as Db, name);
    if (kind === 'resource') return customers.countResourceTypeUses(d as Db, name);
    const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(resourceTypes).where(eq(resourceTypes.family, name));
    return Number(r?.n || 0);
  };

  /** Moves the records that carry `from` to `to`; a family's resource types move one at a time, recounting Moda. */
  const replaceUses = async (tx: Tx, from: string, to: string): Promise<number> => {
    if (kind === 'visit') return customers.replaceVisitType(tx as unknown as Db, from, to);
    if (kind === 'resource') return customers.replaceResourceType(tx as unknown as Db, from, to);
    const types = await tx.select({ id: resourceTypes.id, name: resourceTypes.name }).from(resourceTypes).where(eq(resourceTypes.family, from));
    for (const type of types) {
      await customers.recountForFamilyChange(tx as unknown as Db, type.name, from, to, familyLookup(await familyRows(tx)));
      await tx.update(resourceTypes).set({ family: to, updatedAt: new Date() }).where(eq(resourceTypes.id, type.id));
    }
    return types.length;
  };

  return {
    list: () => all(db, kind),
    byId: async id => (isId(id) ? (await all(db, kind)).find(d => d._id === id) ?? null : null),

    async add(id, value, order, by) {
      const now = new Date();
      const doc: Loose = {
        ...(kind === 'visit' ? { system: false } : kind === 'family' ? { system: false } : {}),
        ...value, _id: id, name: value.label, order, updatedBy: by, createdAt: now, updatedAt: now
      };
      if (kind === 'resource' && doc.family === undefined) doc.family = 'other';
      try {
        await db.transaction(async tx => { await lockTypes(tx); await save(tx, kind, doc, true); });
      } catch (err) {
        if (((err as Loose)?.cause?.code ?? (err as Loose)?.code) === '23505') return { duplicate: true };
        throw err;
      }
      return { type: doc };
    },

    async reorder(ids, by) {
      await db.transaction(async tx => {
        await lockTypes(tx);
        for (let order = 0; order < ids.length; order++) {
          await tx.update(t).set({ sortOrder: order, updatedBy: by, updatedAt: new Date() } as never).where(eq(t.id, ids[order]!));
        }
      });
      return (await all(db, kind)).sort((a, b) => a.order - b.order);
    },

    async edit(id, value, by) {
      if (!isId(id)) return null;
      return db.transaction(async tx => {
        await lockTypes(tx);
        const current = (await all(tx, kind)).find(d => d._id === id);
        if (!current) return null;
        const next: Loose = { ...current, ...value, updatedBy: by, updatedAt: new Date() };
        let recounted: number | undefined;
        if (kind === 'resource' && value.family !== undefined && value.family !== current.family) {
          // Before the type is saved, so each recount reads the families as they were.
          recounted = await customers.recountForFamilyChange(tx as unknown as Db, current.name, current.family, value.family, familyLookup(await familyRows(tx)));
        }
        await save(tx, kind, next, false);
        return recounted === undefined ? { type: next } : { type: next, recounted };
      });
    },

    async uses(id) {
      const doc = isId(id) ? (await all(db, kind)).find(d => d._id === id) : null;
      return doc ? countUses(db, doc.name) : null;
    },

    async remove(doc, target): Promise<RemoveResult> {
      return db.transaction(async tx => {
        await lockTypes(tx);
        // Counted inside so a record saved since the check is moved too, or stops the delete.
        const uses = await countUses(tx, doc.name);
        if (uses > 0 && !target) return { status: 'uses' as const, uses, moved: 0 };
        const moved = uses > 0 && target ? await replaceUses(tx, doc.name, target.name) : 0;
        await tx.delete(t).where(eq(t.id, doc._id));
        return { status: 'ok' as const, uses, moved };
      });
    },

    families: async () => (await db.select({ name: resourceFamilies.name, active: resourceFamilies.active }).from(resourceFamilies).orderBy(asc(resourceFamilies.sortOrder))) as { name: string; active?: boolean }[]
  };
}

/** Type name → family, for the Moda counts (modaCount.ts's loadFamilies). */
export async function familyRowsOf(db: Db): Promise<{ name: string; family: string }[]> {
  return familyRows(db);
}
export async function resourceTypeByName(db: Db, name: string): Promise<Loose | null> {
  const [r] = await db.select().from(resourceTypes).where(eq(resourceTypes.name, name));
  return r ? docOf('resource', r) : null;
}
