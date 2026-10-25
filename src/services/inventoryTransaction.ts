import mongoose from 'mongoose';
import type { ClientSession } from 'mongoose';
import InventoryRevision from '../models/InventoryRevision.ts';

/** All inventory/hold/purchasing writers acquire this first, in their transaction. */
export async function prepareInventoryRevision(): Promise<void> {
  await InventoryRevision.createCollection();
  try {
    await InventoryRevision.updateOne({ _id: 'inventory' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
  }
}
export async function touchInventoryRevision(session: ClientSession): Promise<number> {
  const record = await InventoryRevision.findOneAndUpdate({ _id: 'inventory' }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
  if (!record) throw new Error('Inventory publication guard is unavailable');
  return record.revision;
}
export async function inventoryRevision(session: ClientSession | null = null): Promise<number> {
  return (await InventoryRevision.findById('inventory').session(session).lean())?.revision || 0;
}
export async function inInventoryTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  await prepareInventoryRevision();
  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => {
      await touchInventoryRevision(session);
      result = await work(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}

/** Coherent multi-source read without incrementing the publication revision. */
export async function inInventorySnapshot<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  let result!: T;
  try {
    await session.withTransaction(async () => { result = await work(session); }, { readConcern: { level: 'snapshot' } });
    return result;
  } finally { await session.endSession(); }
}
