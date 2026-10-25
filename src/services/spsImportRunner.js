import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import CustomerDeleteBackup from '../models/CustomerDeleteBackup.js';
import SpsImportRun from '../models/SpsImportRun.js';
import SpsImportItem from '../models/SpsImportItem.js';
import { backupAndDeleteCustomer } from '../routes/customerBulkDelete.js';
import { ANSWER } from '../utils/spsImportPlan.js';
import { geocodeCustomersInBackground } from './customerGeocoding.js';

/**
 * Carries out a frozen SPS import plan (step 5 of the "SPS Import Redesign"
 * artifact): freeze → write in batches → check → (maybe) undo.
 *
 * Everything here is safe to repeat. The plan is frozen into SpsImportItem rows
 * when the run starts, and only 'pending' ones are ever picked up, so a server
 * restart resumes where it stopped. "Add" is "add only if no customer holds
 * this SPS name" (an upsert on `sps.key`, which the partial unique index also
 * guards), so a retry can't double anything. Updates never touch a field the
 * plan didn't list, and connecting only happens where no key is held.
 */
const BATCH = 100;
const WRITING = new Set(['new', 'update', 'restore', 'keptDeleted']);
const active = new Set(); // runIds being worked in this process

const idOf = (id) => new mongoose.Types.ObjectId(String(id));

/** Save the plan's outcomes as the run's items and mark the run as running. */
export async function freezePlan(run, plan, startedBy = '') {
  const items = plan.outcomes
    .filter((o) => o.action !== 'decision' && o.action !== 'deleted')
    .map((o, seq) => ({
      runId: String(run._id),
      seq,
      key: o.key,
      rowNumber: o.rowNumber,
      name: o.name,
      action: o.action,
      customerId: o.customerId || '',
      connect: !!o.connect,
      create: o.create,
      apply: o.apply || undefined,
      before: o.before,
      unset: o.unset || [],
      changes: o.changes || [],
      deleted: o.deleted,
      warnings: o.warnings || [],
      // Nothing to write: finished already.
      state: WRITING.has(o.action) ? 'pending' : 'done',
      result: o.action === 'unchanged' ? 'unchanged' : ''
    }));
  await SpsImportItem.deleteMany({ runId: String(run._id) });
  if (items.length) await SpsImportItem.insertMany(items, { ordered: true });
  await SpsImportRun.updateOne({ _id: run._id }, {
    $set: {
      status: 'running', startedAt: new Date(), total: items.length, done: 0,
      planCounts: plan.counts, results: {}, verify: null, error: '', createdBy: run.createdBy || startedBy
    },
    $unset: { file: 1 }
  });
  return items.length;
}

const bump = (run, result) => SpsImportRun.updateOne({ _id: run }, { $inc: { [`results.${result}`]: 1, done: 1 } });

/** Write one item. Returns { result, reason?, createdId? }; never throws for a data problem. */
async function writeItem(item, runId) {
  const stamp = new Date();
  try {
    if (item.action === 'new') {
      const doc = new Customer({
        ...item.create,
        sps: { key: item.key, name: item.name, firstImportedAt: stamp, lastSeenAt: stamp, connectedAt: stamp, connectedBy: 'SPS import', runId }
      });
      await doc.validate();
      const raw = doc.toObject({ virtuals: false, getters: false });
      const res = await Customer.collection.updateOne({ 'sps.key': item.key }, { $setOnInsert: raw }, { upsert: true });
      if (res.upsertedCount) return { result: 'added', createdId: String(raw._id) };
      const there = await Customer.collection.findOne({ 'sps.key': item.key }, { projection: { 'sps.runId': 1 } });
      return there?.sps?.runId === runId
        ? { result: 'added', createdId: String(there._id) }   // an earlier try of this run already added it
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
    const taken = err?.code === 11000;
    return { result: 'failed', reason: taken ? `${String(err.keyPattern ? Object.keys(err.keyPattern)[0] : 'a unique value')} is already used by another customer` : err.message };
  }
}

/** Work the run's pending items in batches, then check it. One worker per run. */
export async function runItems(runId) {
  runId = String(runId);
  if (active.has(runId)) return;
  active.add(runId);
  try {
    // Two rounds at most: after the first check, whatever failed (a dropped
    // connection, usually) gets one more try before the run says what's missing.
    for (let round = 0; round < 2; round++) {
      for (;;) {
        const batch = await SpsImportItem.find({ runId, state: 'pending' }).sort({ seq: 1 }).limit(BATCH).lean();
        if (!batch.length) break;
        for (const item of batch) {
          const out = await writeItem(item, runId);
          await SpsImportItem.updateOne({ _id: item._id }, { $set: { state: out.result === 'failed' ? 'failed' : 'done', result: out.result, reason: out.reason || '', createdId: out.createdId || '' } });
          await bump(runId, out.result);
        }
      }
      const verify = await checkRun(runId);
      const failed = await SpsImportItem.countDocuments({ runId, state: 'failed' });
      if (verify.ok || round === 1 || !failed) { await finishRun(runId, verify); break; }
      await SpsImportItem.updateMany({ runId, state: 'failed' }, { $set: { state: 'pending', result: '', reason: '' } });
      await SpsImportRun.updateOne({ _id: runId }, { $inc: { done: -failed, 'results.failed': -failed } });
    }
  } catch (err) {
    console.error('SPS import run error:', err);
    await SpsImportRun.updateOne({ _id: runId }, { $set: { status: 'failed', error: err.message, finishedAt: new Date() } });
  } finally {
    active.delete(runId);
  }
}

const finishRun = async (runId, verify) => {
  await SpsImportRun.updateOne({ _id: runId }, { $set: { verify, status: 'done', finishedAt: new Date() } });
  // Added, restored and updated customers are saved 'pending' (no pin); give them one now.
  const written = await SpsImportItem.find({ runId, state: 'done', result: { $in: ['added', 'updated', 'restored'] } }).select('createdId customerId').lean();
  geocodeCustomersInBackground(written.map((i) => i.createdId || i.customerId).filter(Boolean));
};

/**
 * The after-import check, separate from the writer: look every SPS name of the
 * file up in the database and say which aren't there and why. A run is only
 * green with nothing missing.
 */
export async function checkRun(runId) {
  runId = String(runId);
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

/** Re-run only the items that failed, then check again. */
export async function retryFailed(runId) {
  runId = String(runId);
  const failed = await SpsImportItem.countDocuments({ runId, state: 'failed' });
  if (!failed) return 0;
  await SpsImportItem.updateMany({ runId, state: 'failed' }, { $set: { state: 'pending', result: '', reason: '' } });
  await SpsImportRun.updateOne({ _id: runId }, { $set: { status: 'running', finishedAt: null }, $inc: { done: -failed, 'results.failed': -failed } });
  runItems(runId);
  return failed;
}

/** On server start: pick up any run that was working when the server stopped. */
export async function resumeRunningImports() {
  const running = await SpsImportRun.find({ status: 'running' }).select('_id').lean();
  for (const r of running) runItems(r._id);
  return running.length;
}

/**
 * Undo a finished import: what it added is removed (saved whole first, marked
 * as the import's own undo so the next import doesn't ask about them), what it
 * updated goes back to the values it replaced, what it brought back is
 * deleted again, and a "keep deleted" answer is forgotten.
 */
export async function undoRun(runId, by = '') {
  runId = String(runId);
  const items = await SpsImportItem.find({ runId, result: { $in: ['added', 'updated', 'restored', 'keptDeleted'] } }).lean();
  const out = { removed: 0, reverted: 0, deletedAgain: 0, forgotten: 0, failed: [] };
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
        const unset = Object.fromEntries((item.unset || []).map((p) => [p, '']));
        const update = {};
        if (Object.keys(set).length) update.$set = set;
        if (Object.keys(unset).length) update.$unset = unset;
        if (Object.keys(update).length) await Customer.collection.updateOne({ _id: idOf(item.customerId) }, update);
        out.reverted++;
      } else if (item.result === 'keptDeleted') {
        await CustomerDeleteBackup.updateOne({ _id: item.deleted?.backupId, spsKeepRun: runId }, { $set: { spsKeepDeleted: false, spsKeepRun: '' } });
        out.forgotten++;
      }
    } catch (err) {
      out.failed.push({ key: item.key, name: item.name, reason: err.message });
    }
  }
  await SpsImportRun.updateOne({ _id: runId }, { $set: { status: 'undone', undoneAt: new Date(), undoneBy: by } });
  return out;
}

export { ANSWER };
