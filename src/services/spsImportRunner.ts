import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';
import * as data from '../db/customers/index.ts';
import { newId } from '../db/ids.ts';
import { ANSWER } from '../utils/spsImportPlan.ts';
import { geocodeCustomersInBackground } from './customerGeocoding.ts';

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
const active = new Set<string>(); // runIds being worked in this process

/** Save the plan's outcomes as the run's items and mark the run as running. */
export async function freezePlan(run: Loose, plan: Loose, startedBy = '') {
  const items = plan.outcomes
    .filter((o: Loose) => o.action !== 'decision' && o.action !== 'deleted')
    .map((o: Loose, seq: number) => ({
      _id: newId(),
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
  await data.spsFreezeRun(run, items, {
    status: 'running', startedAt: new Date(), total: items.length, done: 0,
    planCounts: plan.counts, results: {}, verify: null, error: '', createdBy: run.createdBy || startedBy
  });
  return items.length;
}

/** Work the run's pending items in batches, then check it. One worker per run. */
export async function runItems(rawRunId: unknown) {
  const runId = String(rawRunId);
  if (active.has(runId)) return;
  active.add(runId);
  try {
    // Who started the run is who created the customers it adds (blank on runs saved before 2026-11-08).
    const starter = await data.spsStarterOf(runId);
    const createdBy = starter && mongoose.isValidObjectId(starter) ? String(starter) : undefined;
    // Two rounds at most: after the first check, whatever failed (a dropped
    // connection, usually) gets one more try before the run says what's missing.
    for (let round = 0; round < 2; round++) {
      for (;;) {
        const batch = await data.spsPendingBatch(runId, BATCH);
        if (!batch.length) break;
        for (const item of batch) {
          const out = await data.spsWriteItem(item, runId, createdBy);
          await data.spsRecordItem(item, runId, out);
        }
      }
      const verify = await checkRun(runId);
      const failed = await data.spsFailedCount(runId);
      if (verify.ok || round === 1 || !failed) { await finishRun(runId, verify); break; }
      await data.spsRequeueFailed(runId, failed);
    }
  } catch (err) {
    console.error('SPS import run error:', err);
    await data.spsMarkRunFailed(runId, (err as Error).message);
  } finally {
    active.delete(runId);
  }
}

const finishRun = async (runId: string, verify: Awaited<ReturnType<typeof checkRun>>) => {
  // Added, restored and updated customers are saved 'pending' (no pin); give them one now.
  geocodeCustomersInBackground(await data.spsFinishRun(runId, verify));
};

/**
 * The after-import check, separate from the writer: look every SPS name of the
 * file up in the database and say which aren't there and why. A run is only
 * green with nothing missing.
 */
export async function checkRun(rawRunId: unknown) {
  return (await data.spsCheckRun(String(rawRunId))) as {
    checkedAt: Date; expected: number; present: number; keptDeleted: number;
    missing: { key: string; name: string; rowNumber: number; reason: string }[]; missingCount: number; ok: boolean;
  };
}

/** Re-run only the items that failed, then check again. */
export async function retryFailed(rawRunId: unknown) {
  const runId = String(rawRunId);
  const failed = await data.spsFailedCount(runId);
  if (!failed) return 0;
  await data.spsRequeueFailed(runId, failed, { running: true });
  runItems(runId);
  return failed;
}

/** On server start: pick up any run that was working when the server stopped. */
export async function resumeRunningImports() {
  const running = await data.spsRunningRunIds();
  for (const r of running) runItems(r);
  return running.length;
}

/**
 * Undo a finished import: what it added is removed (saved whole first, marked
 * as the import's own undo so the next import doesn't ask about them), what it
 * updated goes back to the values it replaced, what it brought back is
 * deleted again, and a "keep deleted" answer is forgotten.
 */
export async function undoRun(rawRunId: unknown, by = '') {
  return data.spsUndoRun(String(rawRunId), by);
}

export { ANSWER };
