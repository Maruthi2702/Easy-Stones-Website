/**
 * The customer imports' saves on MongoDB, moved here from server.ts and
 * src/routes/customerSpsConnect.ts unchanged. Postgres twin: imports.postgres.ts; pick
 * through imports.ts. Changes: the memory's first save takes its _id from the caller, and
 * the SPS names come in as a map instead of the route's own lookup.
 */
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import ImportMemory from '../../../models/ImportMemory.ts';
import { insertInBatches, withDbRetry, hasRowErrorsOnly } from '../../../utils/dbRetry.ts';
import type { Loose } from '../../../types/records.ts';
import type { ConnectInput, ConnectResult, ImportUpdate, MemorySave } from './importsTypes.ts';

/** The customers a plan is judged against (`select` is Mongoose's field list). */
export async function customersForPlan(select: string): Promise<Loose[]> {
  return Customer.find({}, select).lean() as unknown as Loose[];
}

/** The remembered answers, or null. A lean Map field may come back as a Map or an object. */
export async function readImportMemory(): Promise<Loose | null> {
  return ImportMemory.findOne({ kind: 'customer' }).lean() as unknown as Loose | null;
}

export async function saveImportMemory({ set, by, id }: MemorySave): Promise<void> {
  await ImportMemory.updateOne(
    { kind: 'customer' },
    { $set: { ...set, updatedBy: by }, $setOnInsert: { _id: id } },
    { upsert: true }
  );
}

export async function forgetImportMemory(): Promise<void> {
  await ImportMemory.deleteOne({ kind: 'customer' });
}

/** POST /api/customers/sps-connect/apply, the writes. */
export async function connectSps({ connect, notInSps, nameByKey, by, now }: ConnectInput): Promise<ConnectResult> {
  const stamp = (key: string) => ({
    'sps.key': key,
    'sps.name': nameByKey[key],
    'sps.firstImportedAt': now,
    'sps.lastSeenAt': now,
    'sps.connectedAt': now,
    'sps.connectedBy': by
  });
  const idOf = (customerId: string) => new mongoose.Types.ObjectId(customerId);
  const connectOps = connect.map(({ customerId, key }) => ({
    updateOne: { filter: { _id: idOf(customerId), 'sps.key': { $exists: false } }, update: { $set: stamp(key) } }
  }));
  const notInSpsOps = notInSps.map((customerId) => ({
    updateOne: {
      filter: { _id: idOf(customerId), 'sps.key': { $exists: false } },
      update: { $set: { 'sps.reviewedAs': 'none', 'sps.connectedAt': now, 'sps.connectedBy': by } }
    }
  }));

  // ordered:false — one name taken in the meantime must not stop the rest.
  const failed: Loose[] = [];
  const run = async (ops: Parameters<typeof Customer.collection.bulkWrite>[0]) => {
    if (!ops.length) return 0;
    try {
      return (await Customer.collection.bulkWrite(ops, { ordered: false })).modifiedCount;
    } catch (err) {
      if (!(err as Error & Loose).writeErrors && !(err as Error & Loose).result) throw err;
      for (const e of (err as Error & Loose).writeErrors || []) {
        const op = ops[e.index ?? e.err?.index] as Loose | undefined;
        failed.push({ customerId: String(op?.updateOne?.filter?._id || ''), reason: e.code === 11000 ? 'another customer took that SPS name first' : (e.errmsg || 'could not be saved') });
      }
      return (err as Error & Loose).result?.modifiedCount ?? (err as Error & Loose).result?.nModified ?? 0;
    }
  };
  const connected = await run(connectOps);
  const markedNotInSps = await run(notInSpsOps);
  return { connected, notInSps: markedNotInSps, failed: failed as ConnectResult['failed'] };
}

/**
 * POST /api/customers/import/apply: add the validated documents (each has its _id).
 * Rows the database refuses for their data come back by index into `docs`.
 */
export async function insertImportedCustomers(docs: Loose[], batchSize: number): Promise<Map<number, string>> {
  return insertInBatches(Customer, docs, { batchSize });
}

/** The apply route's updates, a batch at a time. Index into `batch` → why it wasn't saved. */
export async function updateImportedCustomers(batch: ImportUpdate[]): Promise<Map<number, string>> {
  const failed = new Map<number, string>();
  // $set is safe to send twice, so a dropped connection just resends it.
  await withDbRetry(async () => {
    failed.clear();
    try {
      await Customer.bulkWrite(
        batch.map(row => ({ updateOne: { filter: { _id: row.targetId }, update: { $set: row.apply } } })),
        { ordered: false }
      );
    } catch (err) {
      // A dropped connection (a bulk write error listing no rows) fails
      // the whole batch — throw, so withDbRetry resends it.
      if (!hasRowErrorsOnly(err)) throw err;
      for (const we of (err as Error & Loose).writeErrors) failed.set(we.index ?? we.err?.index, we.errmsg || we.err?.errmsg || 'Could not be saved');
    }
  });
  return failed;
}
