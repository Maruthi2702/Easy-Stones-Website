/**
 * Purchasing on Postgres, answering in MongoDB's shape (docs.ts). A save builds the record
 * as MongoDB would hold it, then makes its rows with the copy's own builder (purchasingRows),
 * so it writes what a re-copy of MongoDB would.
 *
 * Races (see README.md): a lock is a row whose primary key is the stock line, inserted in
 * the same transaction as its draft, so two drafts can never both hold it; a scope or a
 * draft changes only through a statement that names the version (and status) it read.
 */
import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../copy/plan.ts';
import {
  purchasingScopes, purchasingScopeAliases, purchasingScopePolicies, purchasingInbound, purchasingDrafts,
  purchasingDraftHistory, purchasingLocks, purchasingPoLinks
} from '../schema/purchasing.ts';
import { purchasingRows, type PurchasingSource } from '../copy/purchasingRows.ts';
import { scopeDoc, inboundDoc, draftDoc } from './docs.ts';
import type { Loose } from '../../types/records.ts';
import type { PurchasingStore } from './types.ts';
import type { ClientSession } from 'mongoose';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;
const q = (c: Conn) => c as Db;
const lower = (id: unknown) => String(id).toLowerCase();
const HEX24 = /^[0-9a-f]{24}$/i;

/** MongoDB's duplicate-key error, which the route layer already answers with a 409. */
const duplicate = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const isUnique = (e: unknown): boolean => {
  for (let x = e as { code?: string; cause?: unknown } | undefined, i = 0; x && i < 4; x = x.cause as typeof x, i++) if (x.code === '23505') return true;
  return false;
};
async function uniquely<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (e) { throw isUnique(e) ? duplicate() : e; }
}

const none: PurchasingSource = { purchasingScopes: [], purchasingInbound: [], purchasingDrafts: [], purchasingLocks: [], purchasingPoLinks: [] };
function built(src: Partial<PurchasingSource>) {
  const problems: never[] = [];
  return purchasingRows({ ...none, ...src }, problems as never);
}

async function scopesWhere(db: Db, where: ReturnType<typeof eq> | undefined): Promise<Loose[]> {
  const rows = await db.select().from(purchasingScopes).where(where)
    .orderBy(sql`${purchasingScopes.name} collate "C"`, asc(purchasingScopes.id));
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [aliases, policies] = await Promise.all([
    db.select().from(purchasingScopeAliases).where(inArray(purchasingScopeAliases.scopeId, ids)),
    db.select().from(purchasingScopePolicies).where(inArray(purchasingScopePolicies.scopeId, ids))
  ]);
  return rows.map(r => scopeDoc(r, aliases.filter(a => a.scopeId === r.id), policies.filter(p => p.scopeId === r.id)));
}

async function draftsWhere(db: Db, where: ReturnType<typeof eq> | undefined, limit?: number): Promise<Loose[]> {
  const base = db.select().from(purchasingDrafts).where(where).orderBy(desc(purchasingDrafts.id));
  const rows = await (limit ? base.limit(limit) : base);
  if (!rows.length) return [];
  const history = await db.select().from(purchasingDraftHistory).where(inArray(purchasingDraftHistory.draftId, rows.map(r => r.id)));
  return rows.map(r => draftDoc(r, history.filter(h => h.draftId === r.id)));
}

const ACTIVE = ['draft', 'approved'];

export function pgStore(conn: Conn, session: ClientSession | null): PurchasingStore {
  const db = q(conn);

  /** The scope's row and its alias / policy rows, made by the copy's builder. */
  const scopeRows = (doc: Loose) => built({ purchasingScopes: [doc] });
  const replaceParts = async (id: string, r: ReturnType<typeof scopeRows>) => {
    await db.delete(purchasingScopeAliases).where(eq(purchasingScopeAliases.scopeId, id));
    await db.delete(purchasingScopePolicies).where(eq(purchasingScopePolicies.scopeId, id));
    if (r.purchasingScopeAliases.length) await db.insert(purchasingScopeAliases).values(r.purchasingScopeAliases);
    if (r.purchasingScopePolicies.length) await db.insert(purchasingScopePolicies).values(r.purchasingScopePolicies);
  };

  const store: PurchasingStore = {
    session,
    tx: conn,
    listScopes: () => scopesWhere(db, undefined),
    async findScope(id) {
      return HEX24.test(id) ? (await scopesWhere(db, eq(purchasingScopes.id, lower(id))))[0] ?? null : null;
    },
    async createScope(id, fields) {
      const now = new Date();
      const r = scopeRows({ _id: lower(id), ...fields, createdAt: now, updatedAt: now, __v: 0 });
      await db.insert(purchasingScopes).values(r.purchasingScopes[0]);
      await replaceParts(r.purchasingScopes[0].id, r);
      return (await store.findScope(r.purchasingScopes[0].id))!;
    },
    async updateScope(id, version, fields) {
      if (version === undefined) return null; // MongoDB's { __v: undefined } never matches a saved scope
      const [found] = await db.select().from(purchasingScopes)
        .where(and(eq(purchasingScopes.id, lower(id)), eq(purchasingScopes.version, version))).for('update');
      if (!found) return null;
      const current = (await scopesWhere(db, eq(purchasingScopes.id, found.id)))[0];
      const r = scopeRows({ ...current, ...fields, updatedAt: new Date(), __v: version + 1 });
      const { id: _id, createdAt: _created, ...columns } = r.purchasingScopes[0];
      await db.update(purchasingScopes).set(columns).where(eq(purchasingScopes.id, found.id));
      await replaceParts(found.id, r);
      return (await store.findScope(found.id))!;
    },
    async draftUsesOtherBranch(scopeId, branches) {
      const [row] = await db.select({ one: sql<number>`1` }).from(purchasingDrafts).where(and(
        eq(purchasingDrafts.scopeId, lower(scopeId)),
        sql`exists (select 1 from jsonb_array_elements(${purchasingDrafts.lines}) as l
          where not coalesce(l->>'branch' = any(${branches.length ? sql`array[${sql.join(branches.map(b => sql`${b}`), sql`, `)}]::text[]` : sql`'{}'::text[]`}), false))`)).limit(1);
      return !!row;
    },
    async stampLegacyInboundBranches(scopeId, branches) {
      await db.update(purchasingInbound).set({ branches, updatedAt: new Date() })
        .where(and(eq(purchasingInbound.scopeId, lower(scopeId)), sql`${purchasingInbound.branches} is null`));
    },

    async createInbound(id, doc) {
      const now = new Date();
      const scopeId = lower(doc.scopeId);
      const row = built({ purchasingScopes: [{ _id: scopeId }], purchasingInbound: [{ _id: lower(id), createdAt: now, updatedAt: now, __v: 0, ...doc, scopeId }] }).purchasingInbound[0];
      if (!row) throw new Error('That import can’t be stored.');
      await db.insert(purchasingInbound).values(row);
      return inboundDoc((await db.select().from(purchasingInbound).where(eq(purchasingInbound.id, row.id)))[0]);
    },
    async latestInbound(scopeId) {
      const [row] = await db.select().from(purchasingInbound).where(eq(purchasingInbound.scopeId, lower(scopeId)))
        .orderBy(desc(purchasingInbound.createdAt), desc(purchasingInbound.id)).limit(1);
      return row ? inboundDoc(row) : null;
    },

    async findDraft(id) {
      return HEX24.test(id) ? (await draftsWhere(db, eq(purchasingDrafts.id, lower(id))))[0] ?? null : null;
    },
    activeDrafts: scopeId => draftsWhere(db, and(eq(purchasingDrafts.scopeId, lower(scopeId)), inArray(purchasingDrafts.status, ACTIVE))),
    pastDrafts: (scopeId, { before, limit }) => draftsWhere(db, and(
      eq(purchasingDrafts.scopeId, lower(scopeId)), before ? lt(purchasingDrafts.id, lower(before)) : undefined,
      notInArray(purchasingDrafts.status, ACTIVE)), limit),
    async createDraft(id, doc, locks) {
      const now = new Date();
      const scopeId = lower(doc.scopeId);
      const draftId = lower(id);
      const rows = built({
        purchasingScopes: [{ _id: scopeId }],
        purchasingDrafts: [{ _id: draftId, createdAt: now, updatedAt: now, __v: 0, ...doc, scopeId }],
        purchasingLocks: locks.map(l => ({ _id: l._id, scopeId: lower(l.scopeId), draftId }))
      });
      if (!rows.purchasingDrafts[0]) throw new Error('That draft can’t be stored.');
      // The draft and its locks are one statement each inside the caller's transaction: a lock
      // already held (the primary key) fails the draft too.
      await uniquely(async () => {
        await db.insert(purchasingDrafts).values(rows.purchasingDrafts);
        if (rows.purchasingDraftHistory.length) await db.insert(purchasingDraftHistory).values(rows.purchasingDraftHistory);
        if (rows.purchasingLocks.length) await db.insert(purchasingLocks).values(rows.purchasingLocks);
      });
      return (await store.findDraft(draftId))!;
    },
    async changeDraft(id, { version, fromStatus, status, linkedPoLines, entry }) {
      const draftId = lower(id);
      // One conditional statement: whoever changes the draft first wins, a second sees no row.
      const [won] = await db.update(purchasingDrafts).set({
        status, version: sql`${purchasingDrafts.version} + 1`, updatedAt: new Date(),
        ...(linkedPoLines ? { linkedPoLines } : {})
      }).where(and(eq(purchasingDrafts.id, draftId), eq(purchasingDrafts.version, version), eq(purchasingDrafts.status, fromStatus)))
        .returning({ id: purchasingDrafts.id });
      if (!won) return null;
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(purchasingDraftHistory).where(eq(purchasingDraftHistory.draftId, draftId));
      await db.insert(purchasingDraftHistory).values({ draftId, position: n, action: entry.action, at: entry.at, name: entry.name, note: entry.note });
      return store.findDraft(draftId);
    },
    async insertPoLinks(keys, draftId) {
      if (!keys.length) return;
      await uniquely(() => db.insert(purchasingPoLinks).values(keys.map(id => ({ id, draftId: lower(draftId) }))));
    },
    async releaseLocks(draftId) { await db.delete(purchasingLocks).where(eq(purchasingLocks.draftId, lower(draftId))); },
    async listLocks() {
      return (await db.select().from(purchasingLocks)).map(l => ({ _id: l.id, draftId: l.draftId }));
    }
  };
  return store;
}
