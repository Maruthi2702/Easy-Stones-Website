/**
 * Removing a customer on Postgres, and bringing it back (single Delete, bulk delete and
 * its Undo, the SPS import's own deletes). The twin of backupAndDeleteCustomer and the
 * Undo in core.mongo.ts.
 *
 * MongoDB saves the whole customer document (visits, resources and contacts inside it) in
 * `customerdeletebackups` and removes it; whatever pointed at it by id keeps pointing, and
 * points at it again once Undo restores the document under the same id. Postgres can't
 * keep a foreign key to a missing row, so the same save also remembers what it blanked:
 *
 *   customer_delete_backups.customer = { …the customer as the API sends it…, pg: {
 *       …its rows (merge.postgres.ts `snapshotCustomer`)…,
 *       detached:     [{ kind, ids, value }]            // rows whose customer link was blanked
 *       incomingLinks:[{ customerId, kind, ids }]       // other customers' Partner / not-duplicate lists that held it
 *   } }
 *
 * Backups made before the move are MongoDB's raw document (no `pg`); Undo reads those
 * through the copy's row builder. All of it happens in the caller's transaction.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { EJSON } from 'bson';
import type { Db } from '../../copy/plan.ts';
import {
  customers, customerLinks, schedules, customerDeleteBackups, resources, visits
} from '../../schema/customers.ts';
import { deliveries } from '../../schema/operations.ts';
import { lostSales } from '../../schema/misc.ts';
import { newId } from '../../ids.ts';
import type { Loose } from '../../../types/records.ts';
import {
  snapshotCustomer, customerShape, restoreCustomer, linkList, setLinkList, listOf,
  LEFT_POINTING, idsWhere, columnKey, type CustomerSnapshot, type Detached
} from './merge.postgres.ts';
import { insertCustomerDoc, isUniqueViolation, referenceIndexFromPg } from './customerDocPg.ts';

const KINDS = ['associated', 'not_duplicate'] as const;
type Kind = typeof KINDS[number];

/** What MongoDB leaves pointing at a deleted customer (the copy blanks it), besides LEFT_POINTING. */
const ALSO_POINTING = {
  schedules: { table: schedules, id: schedules.id, column: schedules.customerId },
  deliveries: { table: deliveries, id: deliveries.id, column: deliveries.customerId },
  lost_sales: { table: lostSales, id: lostSales.id, column: lostSales.customerId },
  // A calendar entry's linked visit goes with the visit (the link is blanked, MongoDB's copy blanks it too)
  'schedules.visit': { table: schedules, id: schedules.id, column: schedules.visitId }
} as const;
const SPECS: Record<string, { table: PgTable; id: PgColumn; column: PgColumn }> = { ...ALSO_POINTING, ...LEFT_POINTING };

interface IncomingList { customerId: string; kind: Kind; ids: string[] }
interface BackupPg extends CustomerSnapshot { detached?: Detached[]; incomingLinks?: IncomingList[] }

const exists = async (tx: Db, id: string) => (await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, id))).length > 0;

/** The lists other deletes (not undone yet) took out of other customers' Partner / not-duplicate lists. */
async function pendingLists(tx: Db): Promise<IncomingList[]> {
  const rows = await tx.select({ links: sql<IncomingList[] | null>`${customerDeleteBackups.customer} -> 'pg' -> 'incomingLinks'` })
    .from(customerDeleteBackups).where(isNull(customerDeleteBackups.undoneAt));
  return rows.flatMap(r => r.links ?? []);
}

/**
 * MongoDB keeps a list whole while a customer in it is deleted; a table can't, so a list
 * is put back together from what is in it now and what other pending deletes took out
 * of it (the longest one is the base; anything else lands after the one before it).
 */
export function mergeLists(current: string[], recorded: string[][]): string[] {
  const all = [current, ...recorded];
  const merged = [...all.reduce((best, l) => (l.length > best.length ? l : best), [] as string[])];
  for (const list of all) {
    list.forEach((id, i) => {
      if (merged.includes(id)) return;
      const before = list.slice(0, i).reverse().find(o => merged.includes(o));
      merged.splice(before === undefined ? 0 : merged.indexOf(before) + 1, 0, id);
    });
  }
  return merged;
}

/**
 * Save the customer whole to customer_delete_backups, then remove it with everything that
 * depended on it. false = there was no such customer.
 */
export async function removeCustomerWithBackup(tx: Db, id: string, o: { batchId: string; deletedBy: string; source: string }): Promise<boolean> {
  if (!(await exists(tx, id))) return false;
  const snap = await snapshotCustomer(tx, id);
  const shape = await customerShape(tx, id);
  const ownVisits = new Set(snap.visits.map(v => v.id as string));
  const ownReactions = new Set(snap.visitReactions.map(r => r.id as string));

  // Other customers' lists that hold this one.
  const incoming: IncomingList[] = [];
  const holders = await tx.select({ customerId: customerLinks.customerId, kind: customerLinks.kind }).from(customerLinks)
    .where(eq(customerLinks.otherCustomerId, id));
  if (holders.length) {
    const pending = await pendingLists(tx);
    for (const h of holders) {
      const kind = h.kind as Kind;
      const others = pending.filter(p => p.customerId === h.customerId && p.kind === kind).map(p => p.ids);
      incoming.push({ customerId: h.customerId, kind, ids: mergeLists(await linkList(tx, h.customerId, kind), others) });
    }
  }

  // Rows that point at it from elsewhere (not its own visits and the reactions on them).
  const detached: Detached[] = [];
  for (const [kind, spec] of Object.entries(SPECS)) {
    let ids = await idsWhere(tx, spec.id, spec.table, spec.column, id);
    if (kind.startsWith('visits.')) ids = ids.filter(v => !ownVisits.has(v));
    if (kind === 'visit_reactions') ids = ids.filter(r => !ownReactions.has(r));
    if (ids.length && kind !== 'schedules.visit') detached.push({ kind, ids, value: id });
  }
  // Calendar entries linked to one of its visits: each goes back to its own visit.
  if (ownVisits.size) {
    const linked = await tx.select({ id: schedules.id, visitId: schedules.visitId }).from(schedules).where(inArray(schedules.visitId, [...ownVisits]));
    for (const r of linked) detached.push({ kind: 'schedules.visit', ids: [r.id], value: r.visitId! });
  }

  const now = new Date();
  await tx.insert(customerDeleteBackups).values({
    id: newId(), batchId: o.batchId, customerId: id,
    customer: JSON.parse(JSON.stringify({ ...shape, pg: { ...snap, detached, incomingLinks: incoming } })),
    source: o.source, deletedBy: o.deletedBy, createdAt: now, updatedAt: now
  });

  for (const d of detached) {
    const spec = SPECS[d.kind];
    await tx.update(spec.table).set({ [columnKey(spec.table, spec.column)]: null } as never).where(inArray(spec.id, d.ids));
  }
  await tx.delete(resources).where(eq(resources.customerId, id));
  await tx.delete(visits).where(eq(visits.customerId, id));
  await tx.delete(customers).where(eq(customers.id, id)); // its login, contacts and both directions of its links go with it
  // The lists that held it, numbered again from 0 as the copy numbers them.
  for (const l of incoming) await setLinkList(tx, l.customerId, l.kind, l.ids.filter(o2 => o2 !== id));
  return true;
}

/**
 * A snapshot's links to other customers (who logged a visit, who reacted) are dropped where
 * that customer isn't there any more, so the rest can go back. (Restoring newest delete first
 * keeps them whenever the other customer was deleted in the same click.)
 */
async function withoutMissingCustomers(tx: Db, snap: BackupPg): Promise<BackupPg> {
  const named = new Set<string>();
  for (const v of snap.visits) for (const k of ['createdByCustomerId', 'updatedByCustomerId']) if (v[k]) named.add(v[k] as string);
  for (const r of snap.visitReactions) if (r.customerId) named.add(r.customerId as string);
  if (!named.size) return snap;
  const there = new Set((await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, [...named]))).map(r => r.id));
  const keep = (row: Loose, k: string) => (row[k] && !there.has(row[k] as string) ? { ...row, [k]: null } : row);
  return {
    ...snap,
    visits: snap.visits.map(v => keep(keep(v, 'createdByCustomerId'), 'updatedByCustomerId')),
    visitReactions: snap.visitReactions.map(r => keep(r, 'customerId'))
  };
}

/** Put a backed-up customer (and what pointed at it) back. Throws a unique violation when its email or SPS key was taken since. */
export async function restoreCustomerFromBackup(tx: Db, saved: Loose, customerId: string): Promise<void> {
  const pg = saved?.pg as BackupPg | undefined;
  if (!pg) {
    // Saved by MongoDB before the move: its raw document.
    const doc = EJSON.deserialize(saved) as Loose;
    const ok = await insertCustomerDoc(tx, doc, await referenceIndexFromPg(tx));
    if (!ok) throw Object.assign(new Error('the saved copy can\'t be restored (no email or an unknown branch)'), { cannotRestore: true });
    return;
  }
  await restoreCustomer(tx, await withoutMissingCustomers(tx, pg));
  for (const kind of KINDS) await setLinkList(tx, customerId, kind, listOf(pg, kind));
  // What was pointing at it points at it again (only where nothing else took the place).
  for (const d of pg.detached ?? []) {
    const spec = SPECS[d.kind];
    if (!spec) continue;
    const key = columnKey(spec.table, spec.column);
    await tx.update(spec.table).set({ [key]: d.value } as never).where(and(inArray(spec.id, d.ids), isNull(spec.column)));
  }
  for (const l of pg.incomingLinks ?? []) {
    if (!(await exists(tx, l.customerId))) continue;
    const now = await linkList(tx, l.customerId, l.kind);
    if (now.includes(customerId)) continue;
    now.splice(Math.min(Math.max(l.ids.indexOf(customerId), 0), now.length), 0, customerId);
    await setLinkList(tx, l.customerId, l.kind, now);
  }
}

export { isUniqueViolation };
