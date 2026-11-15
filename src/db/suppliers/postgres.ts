/**
 * Supplier POs and the supplier portal on Postgres, answering in MongoDB's shape (supplierDocs.ts). A save
 * builds the record as MongoDB would hold it (the old record with the change on top), then makes its rows
 * with the copy's own builders (supplierRowsOf, supplierPoRowsOf… in copy/cardsSuppliersRows.ts), so it
 * writes what a re-copy of MongoDB would. A PO's or block's children (lines, bundles, history) are rebuilt
 * whole on every save, inside the one transaction that holds the parent row's lock.
 */
import bcrypt from 'bcryptjs';
import { and, asc, desc, eq, gte, inArray, ne, or, sql, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import {
  suppliers, supplierHistory, supplierLogins, supplierPos, supplierPoLines, supplierPoHistory, supplierBlocks, supplierBundles, supplierBlockHistory
} from '../schema/cardsSuppliers.ts';
import { supplierRowsOf, supplierLoginRowOf, supplierPoRowsOf, supplierBlockRowsOf } from '../copy/cardsSuppliersRows.ts';
import { blockDoc, loginDoc, poDoc, supplierDoc } from './supplierDocs.ts';
import type { HistoryLine, PoQuery, SuppliersStore } from './types.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const HEX = /^[0-9a-f]{24}$/i;
/** The id as Postgres keeps it, or null when it is not one (so a bad id finds nothing). */
const lc = (id: unknown): string | null => (typeof id === 'string' && HEX.test(id) ? id.toLowerCase() : null);
const lcAll = (ids: unknown[]) => [...new Set(ids.map(lc).filter((i): i is string => i != null))];

/** Postgres' unique-violation, however drizzle wrapped it. */
const uniqueViolation = (err: unknown): string | null => {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '23505' ? (e?.constraint ?? e?.cause?.constraint ?? '') : null;
};

/** A unique key hit is MongoDB's duplicate-key error (code 11000) to the routes, which already handle it. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (err) {
    const constraint = uniqueViolation(err);
    if (constraint !== null) throw Object.assign(new Error(`duplicate key (${constraint})`), { code: 11000, constraint });
    throw err;
  }
}

const SALT_ROUNDS = 10;

export function pgStore(conn: Db | Tx): SuppliersStore {
  const db = conn as Db;

  // ── Reading ──
  /** History lines of many parents, by parent id. */
  async function historyOf(x: Db, table: typeof supplierHistory | typeof supplierPoHistory | typeof supplierBlockHistory, ids: string[]) {
    const out = new Map<string, (typeof supplierHistory.$inferSelect)[]>();
    if (!ids.length) return out;
    const rows = await x.select().from(table).where(inArray(table.parentId, ids)) as (typeof supplierHistory.$inferSelect)[];
    for (const r of rows) out.set(r.parentId, [...(out.get(r.parentId) ?? []), r]);
    return out;
  }

  const suppliersByRows = async (x: Db, rows: (typeof suppliers.$inferSelect)[]) => {
    const history = await historyOf(x, supplierHistory, rows.map(r => r.id));
    return rows.map(r => supplierDoc(r, history.get(r.id) ?? []));
  };

  async function posByRows(x: Db, rows: (typeof supplierPos.$inferSelect)[], withHistory: boolean): Promise<Loose[]> {
    const ids = rows.map(r => r.id);
    if (!ids.length) return [];
    const lines = await x.select().from(supplierPoLines).where(inArray(supplierPoLines.poId, ids));
    const history = withHistory ? await historyOf(x, supplierPoHistory, ids) : null;
    return rows.map(r => poDoc(r, lines.filter(l => l.poId === r.id), history ? history.get(r.id) ?? [] : null));
  }
  const posByIds = async (x: Db, ids: string[], withHistory: boolean) =>
    posByRows(x, ids.length ? await x.select().from(supplierPos).where(inArray(supplierPos.id, ids)) : [], withHistory);

  async function blocksByRows(x: Db, rows: (typeof supplierBlocks.$inferSelect)[], withHistory: boolean): Promise<Loose[]> {
    const ids = rows.map(r => r.id);
    if (!ids.length) return [];
    const bundles = await x.select().from(supplierBundles).where(inArray(supplierBundles.blockId, ids));
    const history = withHistory ? await historyOf(x, supplierBlockHistory, ids) : null;
    return rows.map(r => blockDoc(r, bundles.filter(b => b.blockId === r.id), history ? history.get(r.id) ?? [] : null));
  }
  const blocksByIds = async (x: Db, ids: string[], withHistory: boolean) =>
    blocksByRows(x, ids.length ? await x.select().from(supplierBlocks).where(inArray(supplierBlocks.id, ids)) : [], withHistory);

  /** Which of these records exist: the links a row is checked against. */
  const existing = async (x: Db, table: typeof suppliers | typeof supplierPos, ids: unknown[]) => {
    const wanted = lcAll(ids);
    return new Set(wanted.length ? (await x.select({ id: table.id }).from(table).where(inArray(table.id, wanted))).map(r => r.id) : []);
  };

  // ── Writing: the rows of a record, as the copy would make them ──
  const poRows = async (x: Db, doc: Loose) => {
    const built = supplierPoRowsOf(doc, await existing(x, suppliers, [doc.supplierId]), []);
    if (!built) throw new Error('That PO can’t be stored: it has no supplier.');
    return built;
  };
  const blockRows = async (x: Db, doc: Loose) => {
    const built = supplierBlockRowsOf(doc, { supplierIds: await existing(x, suppliers, [doc.supplierId]), poIds: await existing(x, supplierPos, [doc.poId]) }, []);
    if (!built) throw new Error('That block can’t be stored: it has no PO or supplier.');
    return built;
  };

  const lowerEmail = (set: Loose): Loose => (typeof set.email === 'string' ? { ...set, email: set.email.trim().toLowerCase() } : set);

  return {
    // ── Suppliers ──
    async listSuppliers() {
      const rows = await db.select().from(suppliers);
      // As MongoDB sorts them: active first, then the name by character code.
      rows.sort((a, b) => Number(b.active) - Number(a.active) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return suppliersByRows(db, rows);
    },
    async supplierById(id) {
      const key = lc(id);
      return key ? (await suppliersByRows(db, await db.select().from(suppliers).where(eq(suppliers.id, key))))[0] ?? null : null;
    },
    async suppliersByIds(ids) {
      const keys = lcAll(ids);
      return keys.length ? suppliersByRows(db, await db.select().from(suppliers).where(inArray(suppliers.id, keys))) : [];
    },
    async supplierNamed(name, exceptId) {
      const except = lc(exceptId);
      const rows = await db.select().from(suppliers).where(and(sql`lower(${suppliers.name}) = lower(${name})`, except ? ne(suppliers.id, except) : undefined)).limit(1);
      return (await suppliersByRows(db, rows))[0] ?? null;
    },
    async supplierBySpsKey(key, exceptId) {
      const except = lc(exceptId);
      const rows = await db.select().from(suppliers).where(and(eq(suppliers.spsKey, key), except ? ne(suppliers.id, except) : undefined)).limit(1);
      return (await suppliersByRows(db, rows))[0] ?? null;
    },
    createSupplier: doc => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const now = new Date();
      const built = supplierRowsOf({ ...doc, createdAt: now, updatedAt: now }, []);
      if (!built) throw new Error('That supplier can’t be stored: it has no id.');
      await x.insert(suppliers).values(built.supplier);
      if (built.history.length) await x.insert(supplierHistory).values(built.history);
      return (await suppliersByRows(x, [(await x.select().from(suppliers).where(eq(suppliers.id, built.supplier.id)))[0]]))[0];
    })),
    updateSupplier: (id, set, add) => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const key = lc(id);
      const [row] = key ? await x.select().from(suppliers).where(eq(suppliers.id, key)).for('update') : [];
      if (!row) return null;
      const before = (await suppliersByRows(x, [row]))[0];
      const built = supplierRowsOf({ ...before, ...set, history: [...before.history, ...add], updatedAt: new Date() }, []);
      if (!built) return null;
      const { id: _id, createdAt: _created, ...columns } = built.supplier;
      await x.update(suppliers).set(columns).where(eq(suppliers.id, row.id));
      await x.delete(supplierHistory).where(eq(supplierHistory.parentId, row.id));
      if (built.history.length) await x.insert(supplierHistory).values(built.history);
      return (await suppliersByRows(x, [(await x.select().from(suppliers).where(eq(suppliers.id, row.id)))[0]]))[0];
    })),

    // ── Portal logins ──
    async allLogins() { return (await db.select().from(supplierLogins)).map(loginDoc); },
    async loginsOf(supplierId, options = {}) {
      const key = lc(supplierId);
      if (!key) return [];
      const rows = await db.select().from(supplierLogins).where(and(
        eq(supplierLogins.supplierId, key),
        options.reachable || options.activeOnly ? eq(supplierLogins.active, true) : undefined,
        options.reachable ? sql`${supplierLogins.password} > ''` : undefined
      ));
      return rows.map(loginDoc);
    },
    async loginById(id) {
      const key = lc(id);
      const [row] = key ? await db.select().from(supplierLogins).where(eq(supplierLogins.id, key)) : [];
      return row ? loginDoc(row) : null;
    },
    async loginByEmail(email, options = {}) {
      const [row] = await db.select().from(supplierLogins).where(and(eq(supplierLogins.email, email), options.activeOnly ? eq(supplierLogins.active, true) : undefined));
      return row ? loginDoc(row) : null;
    },
    async loginByLinkHash(hash) {
      if (!hash) return null;
      const [row] = await db.select().from(supplierLogins).where(eq(supplierLogins.linkTokenHash, hash));
      return row ? loginDoc(row) : null;
    },
    async loginCount(supplierId) {
      const key = lc(supplierId);
      return key ? (await db.select({ id: supplierLogins.id }).from(supplierLogins).where(eq(supplierLogins.supplierId, key))).length : 0;
    },
    async emailTaken(email, exceptId) {
      const except = lc(exceptId);
      return (await db.select({ id: supplierLogins.id }).from(supplierLogins).where(and(eq(supplierLogins.email, email), except ? ne(supplierLogins.id, except) : undefined)).limit(1)).length > 0;
    },
    createLogin: doc => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const now = new Date();
      const row = supplierLoginRowOf(lowerEmail({ ...doc, createdAt: now, updatedAt: now }), await existing(x, suppliers, [doc.supplierId]), []);
      if (!row) throw new Error('That login can’t be stored: it has no supplier.');
      if (row.password) row.password = await bcrypt.hash(row.password, SALT_ROUNDS);
      await x.insert(supplierLogins).values(row);
      return loginDoc((await x.select().from(supplierLogins).where(eq(supplierLogins.id, row.id)))[0]);
    })),
    updateLogin: (id, set) => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const key = lc(id);
      const [found] = key ? await x.select().from(supplierLogins).where(eq(supplierLogins.id, key)).for('update') : [];
      if (!found) return null;
      const change = lowerEmail(set);
      // A new password arrives in plain; only its hash is kept (as the model's save hook does on MongoDB).
      if (typeof change.password === 'string' && change.password) change.password = await bcrypt.hash(change.password, SALT_ROUNDS);
      const row = supplierLoginRowOf({ ...loginDoc(found), ...change, updatedAt: new Date() }, new Set([found.supplierId]), []);
      if (!row) return null;
      const { id: _id, createdAt: _created, ...columns } = row;
      // Nothing changed: nothing is written (and `updatedAt` stays), as Mongoose's save does.
      const { updatedAt: _u1, ...was } = found, { updatedAt: _u2, ...now } = row;
      if (JSON.stringify(was) === JSON.stringify(now)) return loginDoc(found);
      await x.update(supplierLogins).set(columns).where(eq(supplierLogins.id, found.id));
      return loginDoc((await x.select().from(supplierLogins).where(eq(supplierLogins.id, found.id)))[0]);
    })),
    async endSessionsOf(supplierId) {
      const key = lc(supplierId);
      if (key) await db.update(supplierLogins).set({ sessionVersion: sql`${supplierLogins.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(supplierLogins.supplierId, key));
    },

    // ── POs ──
    async poById(id, options = {}) {
      const key = lc(id);
      return key ? (await posByIds(db, [key], options.history !== false))[0] ?? null : null;
    },
    async posByIds(ids) { return posByIds(db, lcAll(ids), false); },
    async poByNumber(poNumber) {
      const [row] = await db.select().from(supplierPos).where(eq(supplierPos.poNumber, poNumber));
      return row ? (await posByRows(db, [row], true))[0] : null;
    },
    async poNumberTaken(poNumber, exceptId) {
      const except = lc(exceptId);
      return (await db.select({ id: supplierPos.id }).from(supplierPos).where(and(eq(supplierPos.poNumber, poNumber), except ? ne(supplierPos.id, except) : undefined)).limit(1)).length > 0;
    },
    async listPos(q: PoQuery) {
      const supplier = q.supplierId ? lc(q.supplierId) : null;
      if (q.supplierId && !supplier) return [];
      const where: (SQL | undefined)[] = [
        q.status ? eq(supplierPos.status, q.status) : undefined,
        q.notCancelled ? ne(supplierPos.status, 'cancelled') : undefined,
        supplier ? eq(supplierPos.supplierId, supplier) : undefined,
        q.openOrSince ? or(eq(supplierPos.status, 'open'), gte(supplierPos.updatedAt, q.openOrSince)) : undefined
      ];
      const rows = await db.select().from(supplierPos).where(and(...where)).orderBy(desc(supplierPos.updatedAt), asc(supplierPos.id)).limit(q.limit ?? 3000);
      return posByRows(db, rows, false);
    },
    createPo: doc => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const now = new Date();
      const built = await poRows(x, { ...doc, __v: 0, createdAt: now, updatedAt: now });
      await x.insert(supplierPos).values(built.po);
      if (built.lines.length) await x.insert(supplierPoLines).values(built.lines);
      if (built.history.length) await x.insert(supplierPoHistory).values(built.history);
      return (await posByIds(x, [built.po.id], true))[0];
    })),
    updatePo: (id, version, set, add) => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const key = lc(id);
      const [row] = key ? await x.select().from(supplierPos).where(eq(supplierPos.id, key)).for('update') : [];
      if (!row || row.version !== version) return null;
      const before = (await posByRows(x, [row], true))[0];
      const built = await poRows(x, { ...before, ...set, history: [...before.history, ...add], updatedAt: new Date(), __v: row.version + 1 });
      const { id: _id, createdAt: _created, ...columns } = built.po;
      await x.update(supplierPos).set(columns).where(eq(supplierPos.id, row.id));
      await x.delete(supplierPoLines).where(eq(supplierPoLines.poId, row.id));
      if (built.lines.length) await x.insert(supplierPoLines).values(built.lines);
      await x.delete(supplierPoHistory).where(eq(supplierPoHistory.parentId, row.id));
      if (built.history.length) await x.insert(supplierPoHistory).values(built.history);
      return (await posByIds(x, [row.id], true))[0];
    })),
    addPoHistory: (id, line: HistoryLine) => db.transaction(async t => {
      const x = t as unknown as Db;
      const key = lc(id);
      const [row] = key ? await x.select().from(supplierPos).where(eq(supplierPos.id, key)).for('update') : [];
      if (!row) return;
      const before = (await posByRows(x, [row], true))[0];
      const built = await poRows(x, { ...before, history: [...before.history, line], updatedAt: new Date() });
      await x.update(supplierPos).set({ updatedAt: built.po.updatedAt }).where(eq(supplierPos.id, row.id));
      await x.delete(supplierPoHistory).where(eq(supplierPoHistory.parentId, row.id));
      await x.insert(supplierPoHistory).values(built.history);
    }),

    // ── Blocks ──
    async blockById(id) {
      const key = lc(id);
      return key ? (await blocksByIds(db, [key], true))[0] ?? null : null;
    },
    async blocksOfPo(poId, options = {}) {
      const po = lc(poId), supplier = options.supplierId ? lc(options.supplierId) : null;
      if (!po || (options.supplierId && !supplier)) return [];
      const rows = await db.select().from(supplierBlocks).where(and(eq(supplierBlocks.poId, po), supplier ? eq(supplierBlocks.supplierId, supplier) : undefined))
        // As MongoDB sorts: a block never sent (no date) first.
        .orderBy(...(options.order === 'created' ? [asc(supplierBlocks.createdAt)] : [sql`${supplierBlocks.firstSentAt} asc nulls first`, asc(supplierBlocks.createdAt)]), asc(supplierBlocks.id));
      return blocksByRows(db, rows, options.history === true);
    },
    async blocksOfPos(poIds, options = {}) {
      const pos = lcAll(poIds), supplier = options.supplierId ? lc(options.supplierId) : null;
      if (!pos.length || (options.supplierId && !supplier)) return [];
      const rows = await db.select().from(supplierBlocks).where(and(inArray(supplierBlocks.poId, pos), supplier ? eq(supplierBlocks.supplierId, supplier) : undefined))
        .orderBy(asc(supplierBlocks.createdAt), asc(supplierBlocks.id));
      return blocksByRows(db, rows, false);
    },
    async blocksWithBundleStatus(status, limit) {
      const rows = await db.select().from(supplierBlocks)
        .where(inArray(supplierBlocks.id, db.select({ id: supplierBundles.blockId }).from(supplierBundles).where(eq(supplierBundles.status, status))))
        .orderBy(sql`${supplierBlocks.sentAt} asc nulls first`, asc(supplierBlocks.id)).limit(limit);
      return blocksByRows(db, rows, false);
    },
    async blocksFirstSentSince(since) {
      return blocksByRows(db, await db.select().from(supplierBlocks).where(gte(supplierBlocks.firstSentAt, since)), false);
    },
    async blocksWithApproved(poIds) {
      const pos = lcAll(poIds);
      if (!pos.length) return [];
      const rows = await db.select().from(supplierBlocks).where(and(
        inArray(supplierBlocks.poId, pos),
        inArray(supplierBlocks.id, db.select({ id: supplierBundles.blockId }).from(supplierBundles).where(eq(supplierBundles.status, 'approved')))
      )).orderBy(asc(supplierBlocks.createdAt), asc(supplierBlocks.id));
      return blocksByRows(db, rows, false);
    },
    createBlock: doc => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const now = new Date();
      const built = await blockRows(x, { ...doc, __v: 0, createdAt: now, updatedAt: now });
      await x.insert(supplierBlocks).values(built.block);
      if (built.bundles.length) await x.insert(supplierBundles).values(built.bundles);
      if (built.history.length) await x.insert(supplierBlockHistory).values(built.history);
      return (await blocksByIds(x, [built.block.id], true))[0];
    })),
    updateBlock: (id, version, set, add) => guarded(() => db.transaction(async t => {
      const x = t as unknown as Db;
      const key = lc(id);
      const [row] = key ? await x.select().from(supplierBlocks).where(eq(supplierBlocks.id, key)).for('update') : [];
      if (!row || row.version !== version) return null;
      const before = (await blocksByRows(x, [row], true))[0];
      const built = await blockRows(x, { ...before, ...set, history: [...before.history, ...add], updatedAt: new Date(), __v: row.version + 1 });
      const { id: _id, createdAt: _created, ...columns } = built.block;
      await x.update(supplierBlocks).set(columns).where(eq(supplierBlocks.id, row.id));
      await x.delete(supplierBundles).where(eq(supplierBundles.blockId, row.id));
      if (built.bundles.length) await x.insert(supplierBundles).values(built.bundles);
      await x.delete(supplierBlockHistory).where(eq(supplierBlockHistory.parentId, row.id));
      if (built.history.length) await x.insert(supplierBlockHistory).values(built.history);
      return (await blocksByIds(x, [row.id], true))[0];
    })),
    async deleteUnsentBlock(id) {
      const key = lc(id);
      if (key) await db.delete(supplierBlocks).where(and(eq(supplierBlocks.id, key), isNull(supplierBlocks.firstSentAt)));
    },
    async renameUnsentBlocks(poId, lineId, to) {
      const po = lc(poId);
      if (po) await db.update(supplierBlocks).set({ ...to, updatedAt: new Date() }).where(and(eq(supplierBlocks.poId, po), eq(supplierBlocks.lineId, lineId), isNull(supplierBlocks.sentAt)));
    }
  };
}
