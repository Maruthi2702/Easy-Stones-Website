/**
 * Duplicate customers on MongoDB: the import screen's Resolve and Undo, moved here from
 * server.ts unchanged (the work itself is src/services/customerMerge.ts, shared with
 * scripts/merge-duplicate-customers.ts). Its Postgres twin is merge.postgres.ts; pick
 * between them through merge.ts.
 *
 * The one change: each backup's id comes from the caller (src/db/ids.ts), so both
 * databases hold the same backup under the same id and Undo finds it in either.
 */
import mongoose from 'mongoose';
import CustomerMergeBackup from '../../../models/CustomerMergeBackup.ts';
import { planFields, contactsFromLosers, snapshotMerge, executeMerge, undoMerge, markSeparate } from '../../../services/customerMerge.ts';
import type { Loose } from '../../../types/records.ts';
import type { ResolveDuplicatesInput, ResolveDuplicatesResult, UndoDuplicatesResult } from './mergeTypes.ts';

/** POST /api/customers/duplicates/resolve, after the route's checks. */
export async function resolveDuplicates(input: ResolveDuplicatesInput): Promise<ResolveDuplicatesResult> {
  const { keepId, actions, who, backupIds } = input;
  const entries = actions;
  const db = mongoose.connection.db!;
  const ids = [keepId, ...entries.map(([id]) => id)];
  const docs = await db.collection('customers')
    .find({ _id: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } }).toArray();
  const byId = new Map(docs.map(d => [String(d._id), d]));
  const missing = ids.find(id => !byId.has(id));
  if (missing) return { missing: true };

  const survivor = byId.get(keepId)!;
  const merging = entries.filter(([, a]) => a === 'merge').map(([id]) => byId.get(id)!);
  const deleting = entries.filter(([, a]) => a === 'delete').map(([id]) => byId.get(id)!);
  const separate = entries.filter(([, a]) => a === 'separate').map(([id]) => id);
  const undoIds: string[] = [];

  // Delete runs first and the merge snapshots after it, so an undo of the
  // merge restores the survivor as it was after the delete — the two undo
  // in reverse order and each puts back exactly what it changed.
  if (deleting.length) {
    const snap = await snapshotMerge(db, survivor, deleting);
    const backup = await CustomerMergeBackup.create({ _id: backupIds.delete, group: snap, action: 'delete', createdBy: who });
    await executeMerge(db, survivor, deleting, { copyDetails: false });
    undoIds.push(String(backup._id));
  }
  if (merging.length) {
    const current = (await db.collection('customers').findOne({ _id: survivor._id }))!;
    const { set } = planFields(current, merging);
    const newContacts = contactsFromLosers(set.email ?? current.email, current, merging);
    const snap = await snapshotMerge(db, current, merging);
    const backup = await CustomerMergeBackup.create({ _id: backupIds.merge, group: snap, action: 'merge', createdBy: who });
    await executeMerge(db, current, merging, { set, newContacts, copyDetails: true });
    undoIds.push(String(backup._id));
  }
  // "These are all different accounts" — the kept one and every member
  // marked separate, each pair recorded, so none of them is asked about again.
  if (separate.length) await markSeparate(db, [keepId, ...separate]);

  return { merged: merging.length, deleted: deleting.length, separate: separate.length, undoIds };
}

/** POST /api/customers/duplicates/undo, after the route's checks. */
export async function undoDuplicates(ids: string[]): Promise<UndoDuplicatesResult> {
  // By _id, not createdAt: both backups from one click can share a millisecond.
  const backups = await CustomerMergeBackup.find({ _id: { $in: ids }, undoneAt: null }).sort({ _id: -1 });
  if (backups.length !== ids.length) return { alreadyUndone: true };
  const db = mongoose.connection.db!;
  for (const b of backups) {
    await undoMerge(db, b.group);
    b.undoneAt = new Date();
    await b.save();
  }
  return { restored: backups.reduce((n, b) => n + ((b.group as Loose).losers?.length || 0), 0) };
}
