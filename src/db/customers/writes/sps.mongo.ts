/**
 * The SPS import runs on MongoDB: the routes' and the runner's own database code
 * (src/routes/customerSpsImport.ts, src/services/spsImportRunner.ts), moved here
 * unchanged. Postgres twin: sps.postgres.ts; pick through sps.ts. The control flow
 * (batches, two rounds, one worker per run) stays in the runner.
 */
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import CustomerDeleteBackup from '../../../models/CustomerDeleteBackup.ts';
import SpsImportRun from '../../../models/SpsImportRun.ts';
import SpsImportItem from '../../../models/SpsImportItem.ts';
import { backupAndDeleteCustomer } from '../../../routes/customerBulkDelete.ts';
import type { Loose } from '../../../types/records.ts';
import type { NewRun, RunOutcome, UndoOutcome } from './spsTypes.ts';

const idOf = (id: unknown) => new mongoose.Types.ObjectId(String(id));
const lean = (q: Loose) => q as unknown as Promise<Loose | null>;

// ── runs (the routes) ────────────────────────────────────────────────────────

export async function createRun(r: NewRun): Promise<Loose> {
  const run = await SpsImportRun.create({
    _id: r.id, fileName: r.fileName, fingerprint: r.fingerprint, file: r.file,
    createdBy: r.createdBy, createdById: r.createdById, mapping: r.mapping, fileCheck: r.fileCheck, rowsRead: r.rowsRead
  });
  return run.toObject() as Loose;
}

export async function currentRuns(who: string) {
  const running = await SpsImportRun.findOne({ status: 'running' }).lean();
  const draft = await SpsImportRun.findOne({ status: 'draft', createdBy: who }).sort({ createdAt: -1 }).lean();
  return { running: running as Loose | null, draft: draft as Loose | null };
}

export async function runHistory(): Promise<Loose[]> {
  return SpsImportRun.find({ status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(100).lean() as unknown as Loose[];
}

export async function getRun(id: string): Promise<Loose | null> {
  return lean(SpsImportRun.findById(id).lean().catch(() => null) as unknown as Loose);
}

export async function getRunFile(id: string): Promise<Buffer | null> {
  const withFile = await SpsImportRun.findById(id).select('+file').lean();
  return withFile?.file ? Buffer.from((withFile.file as Loose).buffer || withFile.file) : null;
}

export async function failedItems(runId: string): Promise<Loose[]> {
  return SpsImportItem.find({ runId, state: 'failed' }).select('name rowNumber reason').limit(100).lean() as unknown as Loose[];
}

export async function deleteDraft(id: string): Promise<boolean> {
  const run = await SpsImportRun.findOne({ _id: id, status: 'draft' }).catch(() => null);
  if (!run) return false;
  await SpsImportRun.deleteOne({ _id: run._id });
  return true;
}

/** Save the answers on a draft; null = no such draft. Answers the fresh run. */
export async function saveRunAnswers(id: string, set: Loose): Promise<Loose | null> {
  const run = await SpsImportRun.findOne({ _id: id, status: 'draft' });
  if (!run) return null;
  if (Object.keys(set).length) await SpsImportRun.updateOne({ _id: run._id }, { $set: set });
  return SpsImportRun.findById(run._id).lean() as unknown as Loose;
}

export async function findRunning(): Promise<Loose | null> {
  return SpsImportRun.findOne({ status: 'running' }).lean() as unknown as Loose | null;
}
export async function findDraft(id: string): Promise<Loose | null> {
  return (await SpsImportRun.findOne({ _id: id, status: 'draft' }))?.toObject() as Loose | null ?? null;
}
export async function findFinished(id: string): Promise<Loose | null> {
  return lean(SpsImportRun.findOne({ _id: id, status: { $in: ['done', 'failed'] } }).catch(() => null) as unknown as Loose);
}

/** Claim the run before anything else so two Starts can't both go. */
export async function claimRun(id: string, set: Loose): Promise<boolean> {
  return !!(await SpsImportRun.findOneAndUpdate({ _id: id, status: 'draft' }, { $set: set }));
}

export async function reportItems(runId: string): Promise<Loose[]> {
  return SpsImportItem.find({ runId }).sort({ seq: 1 }).lean() as unknown as Loose[];
}

export async function itemsPage(runId: string, result: string, page: number, limit: number) {
  const filter = { runId, ...(result ? { result } : { result: { $ne: '' } }) };
  const [total, items] = await Promise.all([
    SpsImportItem.countDocuments(filter),
    SpsImportItem.find(filter).sort({ seq: 1 }).skip((page - 1) * limit).limit(limit)
      .select('rowNumber name result reason changes warnings createdId customerId connect create.company create.location create.salesRepName create.address.city').lean()
  ]);
  return { total, items: items as unknown as Loose[] };
}

export async function customerIdsOf(runId: string, results: string[]): Promise<Loose[]> {
  return SpsImportItem.find({ runId, result: { $in: results } }).select('createdId customerId').lean() as unknown as Loose[];
}

/** The deleted-before list the planner reads. */
export async function deletedBackups(): Promise<Loose[]> {
  return (await CustomerDeleteBackup.find({ undoneAt: null }).lean()).map((d) => ({ ...d, deletedAt: d.createdAt })) as unknown as Loose[];
}

// ── the runner ───────────────────────────────────────────────────────────────

export async function freezeRun(run: Loose, items: Loose[], runSet: Loose): Promise<void> {
  await SpsImportItem.deleteMany({ runId: String(run._id) });
  if (items.length) await SpsImportItem.insertMany(items, { ordered: true });
  await SpsImportRun.updateOne({ _id: run._id }, { $set: runSet, $unset: { file: 1 } });
}

export async function starterOf(runId: string): Promise<string | undefined> {
  return (await SpsImportRun.findById(runId).select('createdById').lean())?.createdById;
}
export async function pendingBatch(runId: string, limit: number): Promise<Loose[]> {
  return SpsImportItem.find({ runId, state: 'pending' }).sort({ seq: 1 }).limit(limit).lean() as unknown as Loose[];
}
export async function recordItem(item: Loose, runId: string, out: RunOutcome): Promise<void> {
  await SpsImportItem.updateOne({ _id: item._id }, { $set: { state: out.result === 'failed' ? 'failed' : 'done', result: out.result, reason: out.reason || '', createdId: out.createdId || '' } });
  await SpsImportRun.updateOne({ _id: runId }, { $inc: { [`results.${out.result}`]: 1, done: 1 } });
}
export async function failedCount(runId: string): Promise<number> {
  return SpsImportItem.countDocuments({ runId, state: 'failed' });
}
/** Failed items go back to pending for another round; the run's counts drop by them. */
export async function requeueFailed(runId: string, failed: number, { running = false } = {}): Promise<void> {
  await SpsImportItem.updateMany({ runId, state: 'failed' }, { $set: { state: 'pending', result: '', reason: '' } });
  await SpsImportRun.updateOne({ _id: runId }, running
    ? { $set: { status: 'running', finishedAt: null }, $inc: { done: -failed, 'results.failed': -failed } }
    : { $inc: { done: -failed, 'results.failed': -failed } });
}
export async function markRunFailed(runId: string, error: string): Promise<void> {
  await SpsImportRun.updateOne({ _id: runId }, { $set: { status: 'failed', error, finishedAt: new Date() } });
}
export async function runningRunIds(): Promise<unknown[]> {
  return (await SpsImportRun.find({ status: 'running' }).select('_id').lean()).map(r => r._id);
}

/** Finish the run; answers the customers it wrote, for the geocoder. */
export async function finishRun(runId: string, verify: Loose): Promise<string[]> {
  await SpsImportRun.updateOne({ _id: runId }, { $set: { verify, status: 'done', finishedAt: new Date() } });
  const written = await SpsImportItem.find({ runId, state: 'done', result: { $in: ['added', 'updated', 'restored'] } }).select('createdId customerId').lean();
  return written.map((i) => i.createdId || i.customerId).filter(Boolean);
}

/** The after-import check: which SPS names of the run aren't in the database. */
export async function checkRun(runId: string): Promise<Loose> {
  const expected = await SpsImportItem.find({ runId, action: { $in: ['new', 'update', 'unchanged', 'restore'] } }).select('key name rowNumber result reason').lean();
  const present = new Set();
  const keys = expected.map((e) => e.key);
  for (let i = 0; i < keys.length; i += 500) {
    const found = await Customer.collection.find({ 'sps.key': { $in: keys.slice(i, i + 500) } }, { projection: { 'sps.key': 1 } }).toArray();
    for (const f of found) present.add(f.sps.key);
  }
  const missing = expected.filter((e) => !present.has(e.key));
  return {
    checkedAt: new Date(),
    expected: expected.length,
    present: expected.length - missing.length,
    keptDeleted: await SpsImportItem.countDocuments({ runId, action: 'keptDeleted' }),
    missing: missing.slice(0, 200).map((m) => ({ key: m.key, name: m.name, rowNumber: m.rowNumber, reason: m.reason || 'not found after the import' })),
    missingCount: missing.length,
    ok: missing.length === 0
  };
}

/** Write one item. Returns { result, reason?, createdId? }; never throws for a data problem. */
export async function writeItem(item: Loose, runId: string, createdBy?: string): Promise<RunOutcome> {
  const stamp = new Date();
  try {
    if (item.action === 'new') {
      const doc = new Customer({
        ...item.create,
        ...(createdBy ? { createdBy } : {}),
        sps: { key: item.key, name: item.name, firstImportedAt: stamp, lastSeenAt: stamp, connectedAt: stamp, connectedBy: 'SPS import', runId }
      });
      await doc.validate();
      const raw = doc.toObject({ virtuals: false, getters: false });
      const res = await Customer.collection.updateOne({ 'sps.key': item.key }, { $setOnInsert: raw }, { upsert: true });
      if (res.upsertedCount) return { result: 'added', createdId: String(raw._id) };
      const there = await Customer.collection.findOne({ 'sps.key': item.key }, { projection: { 'sps.runId': 1 } });
      return there?.sps?.runId === runId
        ? { result: 'added', createdId: String(there!._id) }   // an earlier try of this run already added it
        : { result: 'unchanged', reason: 'already in Easy Stones' };
    }

    if (item.action === 'update') {
      const filter = { _id: idOf(item.customerId), ...(item.connect ? { 'sps.key': { $exists: false } } : {}) };
      const res = await Customer.collection.updateOne(filter, { $set: item.apply });
      if (res.matchedCount) return { result: 'updated' };
      // A retry of an update that already landed finds the key held by this very customer.
      const same = item.connect && await Customer.collection.findOne({ _id: idOf(item.customerId), 'sps.key': item.key }, { projection: { _id: 1 } });
      return same ? { result: 'updated' } : { result: 'failed', reason: 'the customer changed or was removed while importing' };
    }

    if (item.action === 'restore') {
      const backup = await CustomerDeleteBackup.findById(item.deleted.backupId).lean();
      if (!backup) return { result: 'failed', reason: 'the saved copy of the deleted customer is gone' };
      const exists = await Customer.collection.findOne({ _id: backup.customerId }, { projection: { _id: 1 } });
      if (!exists) await Customer.collection.insertOne(backup.customer);
      const sets = { ...(item.apply || {}), 'sps.runId': runId };
      await Customer.collection.updateOne({ _id: backup.customerId }, { $set: sets });
      await CustomerDeleteBackup.updateOne({ _id: backup._id }, { $set: { undoneAt: stamp, undoneBy: 'SPS import' } });
      return { result: 'restored', createdId: String(backup.customerId) };
    }

    if (item.action === 'keptDeleted') {
      if (!item.deleted?.remembered) {
        await CustomerDeleteBackup.updateOne({ _id: item.deleted.backupId }, { $set: { spsKeepDeleted: true, spsKeepRun: runId } });
      }
      return { result: 'keptDeleted' };
    }
    return { result: 'unchanged' };
  } catch (err) {
    const taken = (err as Error & Loose)?.code === 11000;
    return { result: 'failed', reason: taken ? `${String((err as Error & Loose).keyPattern ? Object.keys((err as Error & Loose).keyPattern)[0] : 'a unique value')} is already used by another customer` : (err as Error).message };
  }
}

/** Undo a finished import (see the runner's comment). */
export async function undoRun(runId: string, by = ''): Promise<UndoOutcome> {
  const items = await SpsImportItem.find({ runId, result: { $in: ['added', 'updated', 'restored', 'keptDeleted'] } }).lean();
  const out: UndoOutcome = { removed: 0, reverted: 0, deletedAgain: 0, forgotten: 0, failed: [] };
  for (const item of items) {
    try {
      if (item.result === 'added' && item.createdId) {
        await backupAndDeleteCustomer(item.createdId, by || 'SPS import undo', 'sps-undo');
        out.removed++;
      } else if (item.result === 'restored' && item.createdId) {
        await backupAndDeleteCustomer(item.createdId, by || 'SPS import undo', 'sps-undo');
        await CustomerDeleteBackup.updateOne({ _id: item.deleted?.backupId }, { $set: { undoneAt: null, undoneBy: '' } });
        out.deletedAgain++;
      } else if (item.result === 'updated') {
        const set = { ...(item.before || {}) };
        const unset = Object.fromEntries((item.unset || []).map((p: string) => [p, '']));
        const update: Loose = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        if (Object.keys(update).length) await Customer.collection.updateOne({ _id: idOf(item.customerId) }, update);
        out.reverted++;
      } else if (item.result === 'keptDeleted') {
        await CustomerDeleteBackup.updateOne({ _id: item.deleted?.backupId, spsKeepRun: runId }, { $set: { spsKeepDeleted: false, spsKeepRun: '' } });
        out.forgotten++;
      }
    } catch (err) {
      out.failed.push({ key: item.key, name: item.name, reason: (err as Error).message });
    }
  }
  await SpsImportRun.updateOne({ _id: runId }, { $set: { status: 'undone', undoneAt: new Date(), undoneBy: by } });
  return out;
}
