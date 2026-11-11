/**
 * The SPS import runs on Postgres: the twin of sps.mongo.ts. Every item is written in its
 * own transaction (a savepoint when the caller already holds one), so a name taken by
 * someone else fails that item alone and a retry or a restart never doubles anything:
 * "add" is "add only if no customer holds this SPS name" (the unique index on sps_key
 * has the last word), "connect" only touches a customer with no name yet.
 *
 * A customer removed by Undo is saved first in customer_delete_backups with the rows as
 * they were under `customer.pg` (beside the fields the planner reads), the way merge.postgres.ts
 * keeps a merge; restoring reads `pg`, or a MongoDB-shaped snapshot (EJSON) copied from before.
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { EJSON } from 'bson';
import Customer from '../../../models/Customer.ts';
import type { Db } from '../../copy/plan.ts';
import { customers, customerLinks, schedules, customerDeleteBackups, resources, visits } from '../../schema/customers.ts';
import { deliveries, paymentsReceived } from '../../schema/operations.ts';
import { spsImportRuns, spsImportItems } from '../../schema/misc.ts';
import { newId } from '../../ids.ts';
import type { Loose } from '../../../types/records.ts';
import { insertCustomerDoc, customerPatch, isUniqueViolation, violatedConstraint } from './customerDocPg.ts';
import { removeCustomerWithBackup, restoreCustomerFromBackup } from './customerRemoval.postgres.ts';
import {
  snapshotCustomer, restoreCustomer, listOf, setLinkList, linkList, customerShape, type CustomerSnapshot
} from './merge.postgres.ts';
import type { NewRun, RunOutcome, UndoOutcome } from './spsTypes.ts';

type RunRow = typeof spsImportRuns.$inferSelect;
type ItemRow = typeof spsImportItems.$inferSelect;
const KINDS = ['associated', 'not_duplicate'] as const;

const runDoc = (r: RunRow): Loose => ({
  _id: r.id, fileName: r.fileName, fingerprint: r.fingerprint, createdBy: r.createdBy, createdById: r.createdById,
  status: r.status, mapping: r.mapping, repAliases: r.repAliases, branchAliases: r.branchAliases, answers: r.answers,
  fileCheck: r.fileCheck, rowsRead: r.rowsRead, total: r.total, done: r.done, results: r.results, planCounts: r.planCounts,
  verify: r.verify, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt, undoneAt: r.undoneAt, undoneBy: r.undoneBy,
  createdAt: r.createdAt, updatedAt: r.updatedAt
});
const itemDoc = (i: ItemRow): Loose => ({
  _id: i.id, runId: i.runId, seq: i.seq, key: i.key, rowNumber: i.rowNumber, name: i.name, action: i.action,
  customerId: i.customerId, connect: i.connect, create: i.create ?? undefined, apply: i.apply ?? undefined,
  before: i.before ?? undefined, unset: i.unset, changes: i.changes ?? [], deleted: i.deleted ?? undefined,
  warnings: i.warnings, state: i.state, result: i.result, reason: i.reason, createdId: i.createdId
});

// ── runs (the routes) ────────────────────────────────────────────────────────

export async function createRun(db: Db, r: NewRun): Promise<Loose> {
  const now = new Date();
  const [row] = await db.insert(spsImportRuns).values({
    id: r.id, fileName: r.fileName, fingerprint: r.fingerprint, file: r.file, createdBy: r.createdBy, createdById: r.createdById,
    mapping: r.mapping, repAliases: {}, branchAliases: {}, answers: {}, fileCheck: r.fileCheck, rowsRead: r.rowsRead,
    results: {}, planCounts: {}, createdAt: now, updatedAt: now
  }).returning();
  return runDoc(row);
}

const one = async (db: Db, where: ReturnType<typeof eq>) => {
  const [row] = await db.select().from(spsImportRuns).where(where);
  return row ? runDoc(row) : null;
};

export async function currentRuns(db: Db, who: string) {
  const [running] = await db.select().from(spsImportRuns).where(eq(spsImportRuns.status, 'running'));
  const [draft] = await db.select().from(spsImportRuns)
    .where(and(eq(spsImportRuns.status, 'draft'), eq(spsImportRuns.createdBy, who))).orderBy(desc(spsImportRuns.createdAt)).limit(1);
  return { running: running ? runDoc(running) : null, draft: draft ? runDoc(draft) : null };
}

export async function runHistory(db: Db): Promise<Loose[]> {
  return (await db.select().from(spsImportRuns).where(ne(spsImportRuns.status, 'draft'))
    .orderBy(desc(spsImportRuns.createdAt)).limit(100)).map(runDoc);
}

export const getRun = (db: Db, id: string) => one(db, eq(spsImportRuns.id, id));

export async function getRunFile(db: Db, id: string): Promise<Buffer | null> {
  const [row] = await db.select({ file: spsImportRuns.file }).from(spsImportRuns).where(eq(spsImportRuns.id, id));
  return row?.file ? Buffer.from(row.file) : null;
}

export async function failedItems(db: Db, runId: string): Promise<Loose[]> {
  const rows = await db.select().from(spsImportItems).where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.state, 'failed'))).limit(100);
  return rows.map(itemDoc);
}

export async function deleteDraft(db: Db, id: string): Promise<boolean> {
  return (await db.delete(spsImportRuns).where(and(eq(spsImportRuns.id, id), eq(spsImportRuns.status, 'draft'))).returning({ id: spsImportRuns.id })).length > 0;
}

export async function saveRunAnswers(db: Db, id: string, set: Loose): Promise<Loose | null> {
  const run = await one(db, and(eq(spsImportRuns.id, id), eq(spsImportRuns.status, 'draft'))!);
  if (!run) return null;
  if (Object.keys(set).length) await db.update(spsImportRuns).set({ ...set, updatedAt: new Date() }).where(eq(spsImportRuns.id, id));
  return getRun(db, id);
}

export const findRunning = (db: Db) => one(db, eq(spsImportRuns.status, 'running'));
export const findDraft = (db: Db, id: string) => one(db, and(eq(spsImportRuns.id, id), eq(spsImportRuns.status, 'draft'))!);
export const findFinished = (db: Db, id: string) => one(db, and(eq(spsImportRuns.id, id), inArray(spsImportRuns.status, ['done', 'failed']))!);

export async function claimRun(db: Db, id: string, set: Loose): Promise<boolean> {
  return (await db.update(spsImportRuns).set({ ...set, updatedAt: new Date() })
    .where(and(eq(spsImportRuns.id, id), eq(spsImportRuns.status, 'draft'))).returning({ id: spsImportRuns.id })).length > 0;
}

export async function reportItems(db: Db, runId: string): Promise<Loose[]> {
  return (await db.select().from(spsImportItems).where(eq(spsImportItems.runId, runId)).orderBy(asc(spsImportItems.seq))).map(itemDoc);
}

export async function itemsPage(db: Db, runId: string, result: string, page: number, limit: number) {
  const where = and(eq(spsImportItems.runId, runId), result ? eq(spsImportItems.result, result) : ne(spsImportItems.result, ''))!;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(spsImportItems).where(where);
  const rows = await db.select().from(spsImportItems).where(where).orderBy(asc(spsImportItems.seq)).limit(limit).offset((page - 1) * limit);
  return { total: Number(n), items: rows.map(itemDoc) };
}

export async function customerIdsOf(db: Db, runId: string, results: string[]): Promise<Loose[]> {
  return (await db.select().from(spsImportItems).where(and(eq(spsImportItems.runId, runId), inArray(spsImportItems.result, results)))).map(itemDoc);
}

export async function deletedBackups(db: Db): Promise<Loose[]> {
  const rows = await db.select().from(customerDeleteBackups).where(isNull(customerDeleteBackups.undoneAt));
  return rows.map(b => ({
    _id: b.id, batchId: b.batchId, customerId: b.customerId, customer: b.customer, source: b.source, deletedBy: b.deletedBy,
    spsKeepDeleted: b.spsKeepDeleted, spsKeepRun: b.spsKeepRun, undoneAt: b.undoneAt, undoneBy: b.undoneBy,
    createdAt: b.createdAt, updatedAt: b.updatedAt, deletedAt: b.createdAt
  }));
}

// ── the runner ───────────────────────────────────────────────────────────────

export async function freezeRun(db: Db, run: Loose, items: Loose[], runSet: Loose): Promise<void> {
  const runId = String(run._id);
  await db.transaction(async tx => {
    await tx.delete(spsImportItems).where(eq(spsImportItems.runId, runId));
    for (let i = 0; i < items.length; i += 500) {
      await tx.insert(spsImportItems).values(items.slice(i, i + 500).map(it => ({
        id: String(it._id), runId, seq: it.seq, key: it.key, rowNumber: it.rowNumber ?? 0, name: it.name ?? '', action: it.action,
        customerId: it.customerId ?? '', connect: !!it.connect, create: jsonOrNull(it.create), apply: jsonOrNull(it.apply),
        before: jsonOrNull(it.before), unset: it.unset ?? [], changes: jsonOrNull(it.changes ?? []), deleted: jsonOrNull(it.deleted),
        warnings: it.warnings ?? [], state: it.state ?? 'pending', result: it.result ?? '', reason: it.reason ?? '', createdId: ''
      })));
    }
    await tx.update(spsImportRuns).set({
      status: runSet.status, startedAt: runSet.startedAt, total: runSet.total, done: runSet.done, planCounts: runSet.planCounts,
      results: runSet.results, verify: runSet.verify, error: runSet.error, createdBy: runSet.createdBy, file: null, updatedAt: new Date()
    }).where(eq(spsImportRuns.id, runId));
  });
}

/** Free-form values as the copy stores them (plain JSON: ids as text, dates as ISO text). */
const jsonOrNull = (v: unknown): never => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v))) as never;

export async function starterOf(db: Db, runId: string): Promise<string | undefined> {
  const [row] = await db.select({ v: spsImportRuns.createdById }).from(spsImportRuns).where(eq(spsImportRuns.id, runId));
  return row?.v;
}
export async function pendingBatch(db: Db, runId: string, limit: number): Promise<Loose[]> {
  return (await db.select().from(spsImportItems).where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.state, 'pending')))
    .orderBy(asc(spsImportItems.seq)).limit(limit)).map(itemDoc);
}

const bump = (n: number, result: string) => ({
  results: sql`jsonb_set(${spsImportRuns.results}, ${`{${result}}`}::text[], to_jsonb(coalesce((${spsImportRuns.results}->>${result})::int, 0) + ${n}))`,
  done: sql`${spsImportRuns.done} + ${n}`,
  updatedAt: new Date()
});

export async function recordItem(db: Db, item: Loose, runId: string, out: RunOutcome): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(spsImportItems).set({
      state: out.result === 'failed' ? 'failed' : 'done', result: out.result, reason: out.reason || '', createdId: out.createdId || ''
    }).where(eq(spsImportItems.id, String(item._id)));
    await tx.update(spsImportRuns).set(bump(1, out.result)).where(eq(spsImportRuns.id, runId));
  });
}
export async function failedCount(db: Db, runId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(spsImportItems).where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.state, 'failed')));
  return Number(n);
}
export async function requeueFailed(db: Db, runId: string, failed: number, { running = false } = {}): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(spsImportItems).set({ state: 'pending', result: '', reason: '' })
      .where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.state, 'failed')));
    await tx.update(spsImportRuns).set({ ...bump(-failed, 'failed'), ...(running ? { status: 'running', finishedAt: null } : {}) })
      .where(eq(spsImportRuns.id, runId));
  });
}
export async function markRunFailed(db: Db, runId: string, error: string): Promise<void> {
  const now = new Date();
  await db.update(spsImportRuns).set({ status: 'failed', error, finishedAt: now, updatedAt: now }).where(eq(spsImportRuns.id, runId));
}
export async function runningRunIds(db: Db): Promise<unknown[]> {
  return (await db.select({ id: spsImportRuns.id }).from(spsImportRuns).where(eq(spsImportRuns.status, 'running'))).map(r => r.id);
}

export async function finishRun(db: Db, runId: string, verify: Loose): Promise<string[]> {
  const now = new Date();
  await db.update(spsImportRuns).set({ verify: jsonOrNull(verify), status: 'done', finishedAt: now, updatedAt: now }).where(eq(spsImportRuns.id, runId));
  const written = await db.select().from(spsImportItems)
    .where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.state, 'done'), inArray(spsImportItems.result, ['added', 'updated', 'restored'])));
  return written.map(i => i.createdId || i.customerId).filter(Boolean);
}

export async function checkRun(db: Db, runId: string): Promise<Loose> {
  const expected = await db.select().from(spsImportItems)
    .where(and(eq(spsImportItems.runId, runId), inArray(spsImportItems.action, ['new', 'update', 'unchanged', 'restore']))).orderBy(asc(spsImportItems.seq));
  const present = new Set<string>();
  const keys = expected.map(e => e.key);
  for (let i = 0; i < keys.length; i += 500) {
    for (const f of await db.select({ k: customers.spsKey }).from(customers).where(inArray(customers.spsKey, keys.slice(i, i + 500)))) if (f.k) present.add(f.k);
  }
  const missing = expected.filter(e => !present.has(e.key));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(spsImportItems).where(and(eq(spsImportItems.runId, runId), eq(spsImportItems.action, 'keptDeleted')));
  return {
    checkedAt: new Date(), expected: expected.length, present: expected.length - missing.length, keptDeleted: Number(n),
    missing: missing.slice(0, 200).map(m => ({ key: m.key, name: m.name, rowNumber: m.rowNumber, reason: m.reason || 'not found after the import' })),
    missingCount: missing.length, ok: missing.length === 0
  };
}

const takenMessage = (err: unknown) => {
  const c = violatedConstraint(err);
  return `${c === 'customers_sps_key_key' ? 'sps.key' : c === 'customers_email_key' ? 'email' : 'a unique value'} is already used by another customer`;
};

export async function writeItem(db: Db, item: Loose, runId: string, createdBy?: string): Promise<RunOutcome> {
  const stamp = new Date();
  try {
    return await db.transaction(async tx => {
      if (item.action === 'new') {
        const doc = new Customer({
          ...item.create,
          ...(createdBy ? { createdBy } : {}),
          sps: { key: item.key, name: item.name, firstImportedAt: stamp, lastSeenAt: stamp, connectedAt: stamp, connectedBy: 'SPS import', runId }
        });
        await doc.validate();
        const raw = doc.toObject({ virtuals: false, getters: false }) as Loose;
        const held = async (): Promise<RunOutcome> => {
          const [there] = await tx.select({ id: customers.id, run: customers.spsRunId }).from(customers).where(eq(customers.spsKey, item.key));
          return there?.run === runId ? { result: 'added', createdId: there.id } : { result: 'unchanged', reason: 'already in Easy Stones' };
        };
        if ((await tx.select({ id: customers.id }).from(customers).where(eq(customers.spsKey, item.key))).length) return held();
        try {
          // A record saved by a raw upsert carries no timestamps; the copy reads them from its id.
          await tx.transaction(async s => { await insertCustomerDoc(s as unknown as Db, raw); });
        } catch (err) {
          if (isUniqueViolation(err) && violatedConstraint(err) === 'customers_sps_key_key') return held();
          throw err;
        }
        return { result: 'added', createdId: String(raw._id) };
      }

      if (item.action === 'update') {
        const patch = await customerPatch(tx, item.apply ?? {});
        const where = and(eq(customers.id, String(item.customerId)), ...(item.connect ? [isNull(customers.spsKey)] : []));
        const matched = Object.keys(patch).length
          ? (await tx.update(customers).set(patch).where(where).returning({ id: customers.id })).length
          : (await tx.select({ id: customers.id }).from(customers).where(where)).length;
        if (matched) return { result: 'updated' };
        // A retry of an update that already landed finds the key held by this very customer.
        const same = item.connect && (await tx.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.id, String(item.customerId)), eq(customers.spsKey, item.key)))).length;
        return same ? { result: 'updated' } : { result: 'failed', reason: 'the customer changed or was removed while importing' };
      }

      if (item.action === 'restore') {
        const [backup] = await tx.select().from(customerDeleteBackups).where(eq(customerDeleteBackups.id, String(item.deleted.backupId)));
        if (!backup) return { result: 'failed', reason: 'the saved copy of the deleted customer is gone' };
        const exists = (await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, backup.customerId))).length;
        if (!exists) await restoreFromBackup(tx, backup.customer as Loose, backup.customerId);
        const patch = await customerPatch(tx, { ...(item.apply || {}), 'sps.runId': runId });
        await tx.update(customers).set(patch).where(eq(customers.id, backup.customerId));
        await tx.update(customerDeleteBackups).set({ undoneAt: stamp, undoneBy: 'SPS import', updatedAt: stamp }).where(eq(customerDeleteBackups.id, backup.id));
        return { result: 'restored', createdId: backup.customerId };
      }

      if (item.action === 'keptDeleted') {
        if (!item.deleted?.remembered) {
          await tx.update(customerDeleteBackups).set({ spsKeepDeleted: true, spsKeepRun: runId, updatedAt: stamp })
            .where(eq(customerDeleteBackups.id, String(item.deleted.backupId)));
        }
        return { result: 'keptDeleted' };
      }
      return { result: 'unchanged' };
    });
  } catch (err) {
    return { result: 'failed', reason: isUniqueViolation(err) ? takenMessage(err) : (err as Error).message };
  }
}

// ── removing and bringing back a customer ────────────────────────────────────

/** backupAndDeleteCustomer's twin (customerRemoval.postgres.ts): saved whole, with what pointed at it, then removed. */
const removeCustomer = (tx: Db, id: string, deletedBy: string, source: string) =>
  removeCustomerWithBackup(tx, id, { batchId: newId(), deletedBy, source });

const restoreFromBackup = restoreCustomerFromBackup;

export async function undoRun(db: Db, runId: string, by = ''): Promise<UndoOutcome> {
  const items = await db.select().from(spsImportItems)
    .where(and(eq(spsImportItems.runId, runId), inArray(spsImportItems.result, ['added', 'updated', 'restored', 'keptDeleted'])))
    .orderBy(asc(spsImportItems.seq));
  const out: UndoOutcome = { removed: 0, reverted: 0, deletedAgain: 0, forgotten: 0, failed: [] };
  for (const item of items) {
    try {
      await db.transaction(async tx => {
        const deleted = item.deleted as Loose | null;
        if (item.result === 'added' && item.createdId) {
          await removeCustomer(tx, item.createdId, by || 'SPS import undo', 'sps-undo');
          out.removed++;
        } else if (item.result === 'restored' && item.createdId) {
          await removeCustomer(tx, item.createdId, by || 'SPS import undo', 'sps-undo');
          await tx.update(customerDeleteBackups).set({ undoneAt: null, undoneBy: '', updatedAt: new Date() }).where(eq(customerDeleteBackups.id, String(deleted?.backupId)));
          out.deletedAgain++;
        } else if (item.result === 'updated') {
          const patch = await customerPatch(tx, (item.before as Loose) || {}, item.unset);
          if (Object.keys(patch).length) await tx.update(customers).set(patch).where(eq(customers.id, item.customerId));
          out.reverted++;
        } else if (item.result === 'keptDeleted') {
          await tx.update(customerDeleteBackups).set({ spsKeepDeleted: false, spsKeepRun: '', updatedAt: new Date() })
            .where(and(eq(customerDeleteBackups.id, String(deleted?.backupId)), eq(customerDeleteBackups.spsKeepRun, runId)));
          out.forgotten++;
        }
      });
    } catch (err) {
      // The counters above moved before the failure only if their step finished.
      out.failed.push({ key: item.key, name: item.name, reason: (err as Error).message });
    }
  }
  const now = new Date();
  await db.update(spsImportRuns).set({ status: 'undone', undoneAt: now, undoneBy: by, updatedAt: now }).where(eq(spsImportRuns.id, runId));
  return out;
}
