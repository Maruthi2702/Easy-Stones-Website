/**
 * Cart & Holds on Postgres, answering in MongoDB's shape (holdDoc.ts). A save builds the record as
 * MongoDB would hold it (same defaults), then makes its rows with the copy's own builders
 * (holdRowsOf, cartRowsOf… in copy/checkInsHoldsRows.ts), so it writes what a re-copy of MongoDB would.
 */
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import { customers } from '../schema/customers.ts';
import { locations } from '../schema/reference.ts';
import {
  salesCarts, salesCartLines, salesHolds, salesHoldLines, salesSlabReservations, salesCounters, salesHoldHistory
} from '../schema/checkInsHolds.ts';
import { holdRowsOf, holdHistoryRowOf, reservationRowOf } from '../copy/checkInsHoldsRows.ts';
import { referenceIndexOf } from '../customers/writes/coreSupport.postgres.ts';
import { newId } from '../ids.ts';
import { cartDoc, holdDoc, historyDoc, reservationDoc } from './holdDoc.ts';
import { HOLD_TABS, type HoldQuery, type HoldsStore } from './types.ts';
import type { Loose } from '../../types/records.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const DAY_MS = 86400000;

/** Postgres' unique-violation, however drizzle wrapped it. */
const uniqueViolation = (err: unknown): string | null => {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '23505' ? (e?.constraint ?? e?.cause?.constraint ?? '') : null;
};

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, m => `\\${m}`)}%`;

function statusClause(status: string, now: Date): SQL | undefined {
  switch (status) {
    case 'active': return and(eq(salesHolds.status, 'active'), gt(salesHolds.expiresAt, now));
    case 'expiring': return and(eq(salesHolds.status, 'active'), gt(salesHolds.expiresAt, now), lte(salesHolds.expiresAt, new Date(now.getTime() + 3 * DAY_MS)));
    case 'expired': return and(eq(salesHolds.status, 'active'), lte(salesHolds.expiresAt, now));
    case 'released': return eq(salesHolds.status, 'released');
    case 'converted': return eq(salesHolds.status, 'converted');
    default: return undefined;
  }
}

function narrowing(q: HoldQuery): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const { scope } = q;
  if (scope.createdById !== undefined) parts.push(eq(salesHolds.createdById, scope.createdById));
  else if (scope.branch !== undefined) parts.push(eq(locations.name, scope.branch));
  else if (scope.branches !== undefined) parts.push(scope.branches.length ? inArray(locations.name, scope.branches) : sql`false`);
  if (q.search) {
    const term = q.search.trim();
    const alternatives: (SQL | undefined)[] = [
      ilike(salesHolds.customerName, likePattern(term)), ilike(salesHolds.job, likePattern(term)),
      sql`${salesHolds.slabKeys} @> ARRAY[${term.toUpperCase()}]::text[]`
    ];
    if (/^\d+$/.test(term)) alternatives.push(eq(salesHolds.number, Number(term)));
    parts.push(or(...alternatives));
  }
  if (q.from) parts.push(gte(salesHolds.createdAt, new Date(`${q.from}T00:00:00Z`)));
  if (q.to) parts.push(lt(salesHolds.createdAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + DAY_MS)));
  return and(...parts);
}

/** The schema's defaults, as Mongoose applies them to a new hold. */
function newHoldDoc(doc: Loose, now: Date): Loose {
  const person = (p: Loose | null | undefined) => ({ id: p?.id ?? '', name: p?.name ?? '' });
  const lines = (doc.lines || []).map((l: Loose) => ({
    slabKey: l.slabKey, serial: '', barcode: '', product: '', category: '', bundle: '', slabNumber: '', block: '', bin: '',
    location: '', dimensions: '', priceCentsPerSf: null, note: '', ...l
  }));
  return {
    status: 'active', job: '', notes: '', commissionNotes: '', chanceToClose: null, expiredNotedAt: null,
    releasedAt: null, releasedBy: null, releaseReason: '', ...doc,
    customer: { id: '', name: '', contact: '', phone: '', email: '', address: '', ...doc.customer },
    createdBy: person(doc.createdBy), updatedBy: person(doc.updatedBy),
    lines, slabKeys: lines.map((l: Loose) => l.slabKey), __v: 0, createdAt: now, updatedAt: now
  };
}

export function pgStore(tx: Db | Tx): HoldsStore {
  const db = tx as Db;

  const holdsByIds = async (ids: string[]): Promise<Loose[]> => {
    if (!ids.length) return [];
    const rows = await db.select({ h: salesHolds, branch: locations.name }).from(salesHolds)
      .innerJoin(locations, eq(locations.id, salesHolds.locationId)).where(inArray(salesHolds.id, ids));
    const lines = await db.select().from(salesHoldLines).where(inArray(salesHoldLines.holdId, ids));
    return rows.map(r => holdDoc(r.h, r.branch, lines.filter(l => l.holdId === r.h.id)));
  };
  const oneHold = async (where: SQL): Promise<Loose | null> => {
    const [found] = await db.select({ id: salesHolds.id }).from(salesHolds).where(where);
    return found ? (await holdsByIds([found.id]))[0] : null;
  };
  const customerIdsOf = async (ids: unknown[]) => {
    const wanted = ids.filter((i): i is string => typeof i === 'string' && /^[0-9a-f]{24}$/i.test(i)).map(i => i.toLowerCase());
    if (!wanted.length) return new Set<string>();
    return new Set((await db.select({ id: customers.id }).from(customers).where(inArray(customers.id, wanted))).map(c => c.id));
  };
  const writeHold = async (doc: Loose) => {
    const built = holdRowsOf(doc, await referenceIndexOf(db), await customerIdsOf([doc.customer?.id]), []);
    if (!built) throw new Error(`Hold #${doc.number} can’t be stored: ${doc.branch ? 'no number or expiry' : 'no branch'}.`);
    return built;
  };

  /**
   * Every cart write is its own transaction with the cart's row locked, so two tabs (or the same person on two
   * devices) take turns even when the store is on the pool and not inside a request's transaction. Inside one it
   * is a savepoint.
   */
  const inCart = async <T>(userId: string, make: { userName: string } | null, work: (x: Db, cart: typeof salesCarts.$inferSelect) => Promise<T>, whenNone: T): Promise<T> => db.transaction(async t => {
    const x = t as unknown as Db;
    if (make) {
      const now = new Date();
      await x.insert(salesCarts).values({ id: newId(), userId, userName: make.userName, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: salesCarts.userId, set: { userName: make.userName, updatedAt: now } });
    }
    const [cart] = await x.select().from(salesCarts).where(eq(salesCarts.userId, userId)).for('update');
    return cart ? work(x, cart) : whenNone;
  });
  const cartLines = (x: Db, cartId: string) => x.select().from(salesCartLines).where(eq(salesCartLines.cartId, cartId)).orderBy(asc(salesCartLines.position));
  /** Takes slabs out of a cart and numbers the lines left 0, 1, 2… again, as the copy of MongoDB's array does. */
  const dropLines = async (x: Db, cartId: string, slabKeys: string[]) => {
    const have = await cartLines(x, cartId);
    const gone = new Set(slabKeys);
    if (!have.some(l => gone.has(l.slabKey))) return;
    await x.delete(salesCartLines).where(eq(salesCartLines.cartId, cartId));
    const kept = have.filter(l => !gone.has(l.slabKey)).map((l, position) => ({ ...l, position }));
    if (kept.length) await x.insert(salesCartLines).values(kept);
  };
  const touch = (x: Db, cartId: string, more: Partial<typeof salesCarts.$inferInsert> = {}) => x.update(salesCarts).set({ ...more, updatedAt: new Date() }).where(eq(salesCarts.id, cartId));

  return {
    session: null,

    async nextHoldNumber() {
      const [row] = await db.insert(salesCounters).values({ name: 'hold', seq: 1 })
        .onConflictDoUpdate({ target: salesCounters.name, set: { seq: sql`${salesCounters.seq} + 1` } }).returning({ seq: salesCounters.seq });
      return Number(row.seq);
    },
    findHold: id => (/^[0-9a-f]{24}$/i.test(id) ? oneHold(eq(salesHolds.id, id.toLowerCase())) : Promise.resolve(null)),
    findHoldByRequestId: requestId => oneHold(eq(salesHolds.requestId, requestId)),
    async createHold(doc) {
      const built = await writeHold(newHoldDoc(doc, new Date()));
      try {
        await db.insert(salesHolds).values(built.hold);
      } catch (err) {
        if (uniqueViolation(err)?.includes('request')) throw Object.assign(new Error('That request was already used.'), { code: 11000, keyPattern: { requestId: 1 } });
        throw err;
      }
      if (built.lines.length) await db.insert(salesHoldLines).values(built.lines);
      return (await oneHold(eq(salesHolds.id, built.hold.id)))!;
    },
    async saveHold(hold) {
      const next = {
        ...hold, slabKeys: (hold.lines || []).map((l: Loose) => l.slabKey), __v: hold.__v + 1, updatedAt: new Date()
      };
      const { hold: row, lines } = await writeHold(next);
      const { id, createdAt: _created, ...set } = row;
      const saved = await db.update(salesHolds).set(set).where(and(eq(salesHolds.id, id), eq(salesHolds.version, hold.__v))).returning({ id: salesHolds.id });
      if (!saved.length) return null;
      await db.delete(salesHoldLines).where(eq(salesHoldLines.holdId, id));
      if (lines.length) await db.insert(salesHoldLines).values(lines);
      return (await oneHold(eq(salesHolds.id, id)))!;
    },
    async listHolds(q) {
      const narrow = narrowing(q);
      const base = () => db.select({ id: salesHolds.id }).from(salesHolds).innerJoin(locations, eq(locations.id, salesHolds.locationId));
      const count = async (tab: string) => (await base().where(and(narrow, statusClause(tab, q.now)))).length;
      const [page, ...counts] = await Promise.all([
        base().where(and(narrow, statusClause(q.status, q.now))).orderBy(desc(salesHolds.createdAt), desc(salesHolds.id)),
        ...HOLD_TABS.map(count)
      ]);
      const ids = page.slice((q.page - 1) * q.limit, q.page * q.limit).map(r => r.id);
      const docs = new Map((await holdsByIds(ids)).map(d => [d._id, d]));
      return {
        total: page.length, items: ids.map(id => docs.get(id)!),
        counts: Object.fromEntries(HOLD_TABS.map((tab, i) => [tab, counts[i]])) as Record<(typeof HOLD_TABS)[number], number>
      };
    },
    async holdsToNote(now, limit) {
      return (await db.select({ id: salesHolds.id }).from(salesHolds)
        .where(and(eq(salesHolds.status, 'active'), lte(salesHolds.expiresAt, now), gt(salesHolds.releaseAt, now), isNull(salesHolds.expiredNotedAt)))
        .orderBy(asc(salesHolds.id)).limit(limit)).map(r => r.id);
    },
    async holdsToRelease(now, limit) {
      return (await db.select({ id: salesHolds.id }).from(salesHolds)
        .where(and(eq(salesHolds.status, 'active'), lte(salesHolds.releaseAt, now))).orderBy(asc(salesHolds.id)).limit(limit)).map(r => r.id);
    },

    async addHistory(entries) {
      if (!entries.length) return;
      const at = new Date();
      const rows = entries.map(e => holdHistoryRowOf({ _id: newId(), at, changes: [], note: '', ...e }, []));
      if (rows.some(r => !r)) throw new Error('A hold history line needs its hold and a time.');
      await db.insert(salesHoldHistory).values(rows as NonNullable<(typeof rows)[number]>[]);
    },
    async history(holdId, limit) {
      if (!/^[0-9a-f]{24}$/i.test(holdId)) return [];
      return (await db.select().from(salesHoldHistory).where(eq(salesHoldHistory.holdId, holdId.toLowerCase()))
        .orderBy(desc(salesHoldHistory.at), asc(salesHoldHistory.id)).limit(limit)).map(historyDoc);
    },

    async reservationsFor(keys) {
      if (!keys.length) return [];
      return (await db.select().from(salesSlabReservations).where(inArray(salesSlabReservations.slabKey, keys))).map(reservationDoc);
    },
    async lockSlabs(hold, lines, by) {
      if (!lines.length) return [];
      const ref = await referenceIndexOf(db);
      const now = new Date();
      const rows = lines.map(l => reservationRowOf({
        _id: newId(), slabKey: l.slabKey, holdId: hold._id, holdNumber: hold.number, customerName: hold.customer?.name || '',
        branch: hold.branch, by, expiresOn: hold.expiresOn, createdAt: now, updatedAt: now
      }, ref, new Set([String(hold._id)]), []));
      const inserted = await db.insert(salesSlabReservations).values(rows as NonNullable<(typeof rows)[number]>[])
        .onConflictDoNothing({ target: salesSlabReservations.slabKey }).returning({ slabKey: salesSlabReservations.slabKey });
      if (inserted.length === lines.length) return [];
      return (await db.select().from(salesSlabReservations).where(inArray(salesSlabReservations.slabKey, lines.map(l => l.slabKey)))).map(reservationDoc);
    },
    async unlockSlabs(holdId, slabKeys) {
      if (slabKeys.length) await db.delete(salesSlabReservations).where(and(eq(salesSlabReservations.holdId, holdId), inArray(salesSlabReservations.slabKey, slabKeys)));
    },
    async unlockHold(holdId) { await db.delete(salesSlabReservations).where(eq(salesSlabReservations.holdId, holdId)); },
    async updateLocks(holdId, set) {
      await db.update(salesSlabReservations).set({ ...set, updatedAt: new Date() }).where(eq(salesSlabReservations.holdId, holdId));
    },
    async locksAtBranches(branches) {
      if (!branches.length) return [];
      return (await db.select().from(salesSlabReservations).where(inArray(salesSlabReservations.branch, branches)).orderBy(asc(salesSlabReservations.id))).map(reservationDoc);
    },

    async getCart(userId) {
      const [cart] = await db.select().from(salesCarts).where(eq(salesCarts.userId, userId));
      return cart ? cartDoc(cart, await cartLines(db, cart.id)) : null;
    },
    ensureCart: (userId, userName) => inCart(userId, { userName }, async (x, cart) => ({ slabKeys: (await cartLines(x, cart.id)).map(l => l.slabKey) }), { slabKeys: [] }),
    // Never makes a cart (as MongoDB's update matches none): the route made it first.
    addCartLines: (userId, lines) => inCart(userId, null, async (x, cart) => {
      const have = await cartLines(x, cart.id);
      const keys = new Set(lines.map(l => l.slabKey));
      if (have.some(h => keys.has(h.slabKey))) return false;
      const start = have.reduce((m, h) => Math.max(m, h.position + 1), 0);
      const built = lines.map((l, i) => ({ cartId: cart.id, position: start + i, slabKey: l.slabKey, product: l.product ?? '', note: l.note ?? '', addedAt: l.addedAt ?? new Date() }));
      if (!built.length) return false;
      await x.insert(salesCartLines).values(built);
      await touch(x, cart.id);
      return true;
    }, false),
    async setCartCustomer(userId, userName, customer) {
      await inCart(userId, { userName }, async (x, cart) => {
        const [known] = customer && /^[0-9a-f]{24}$/i.test(customer.id)
          ? await x.select({ id: customers.id }).from(customers).where(eq(customers.id, customer.id.toLowerCase())) : [];
        await x.update(salesCarts).set({ customerId: known?.id ?? null, customerName: customer ? customer.name : null }).where(eq(salesCarts.id, cart.id));
      }, undefined);
    },
    setCartNote: (userId, slabKey, note) => inCart(userId, null, async (x, cart) => {
      const done = await x.update(salesCartLines).set({ note }).where(and(eq(salesCartLines.cartId, cart.id), eq(salesCartLines.slabKey, slabKey))).returning({ p: salesCartLines.position });
      if (done.length) await touch(x, cart.id);
      return done.length > 0;
    }, false),
    async removeCartSlabs(userId, slabKeys) {
      await inCart(userId, null, async (x, cart) => { await dropLines(x, cart.id, slabKeys); await touch(x, cart.id); }, undefined);
    },
    clearCart: userId => inCart(userId, null, async (x, cart) => {
      const lines = await x.delete(salesCartLines).where(eq(salesCartLines.cartId, cart.id)).returning({ slabKey: salesCartLines.slabKey });
      await touch(x, cart.id, { customerId: null, customerName: null });
      return lines.map(l => l.slabKey);
    }, [] as string[]),
    async othersWith(userId, slabKeys) {
      if (!slabKeys.length) return [];
      const rows = await db.select({ cartId: salesCarts.id, userName: salesCarts.userName, slabKey: salesCartLines.slabKey }).from(salesCartLines)
        .innerJoin(salesCarts, eq(salesCarts.id, salesCartLines.cartId))
        .where(and(ne(salesCarts.userId, userId), inArray(salesCartLines.slabKey, slabKeys)));
      const byCart = new Map<string, { userName: string; slabKeys: string[] }>();
      for (const r of rows) {
        const found = byCart.get(r.cartId) ?? { userName: r.userName, slabKeys: [] };
        found.slabKeys.push(r.slabKey);
        byCart.set(r.cartId, found);
      }
      return [...byCart.values()];
    },
    async releaseFromCart(userId, slabKeys) {
      await inCart(userId, null, async (x, cart) => {
        await dropLines(x, cart.id, slabKeys);
        await touch(x, cart.id);
        if (!(await cartLines(x, cart.id)).length) await touch(x, cart.id, { customerId: null, customerName: null });
      }, undefined);
    }
  };
}
