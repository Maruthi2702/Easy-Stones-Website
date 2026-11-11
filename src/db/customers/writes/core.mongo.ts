/**
 * Customer saves on MongoDB: the routes' own code, moved here unchanged.
 * Its Postgres twin is core.postgres.ts; pick between them through core.ts.
 */
import mongoose from 'mongoose';
import Customer from '../../../models/Customer.ts';
import User from '../../../models/User.ts';
import type { Loose } from '../../../types/records.ts';
import { displayNameOf } from '../../../utils/salesReps.ts';
import { typedModaFields } from '../../../utils/modaTotals.ts';
import { loadFamilies } from '../../../services/modaCount.ts';
import CustomerDeleteBackup from '../../../models/CustomerDeleteBackup.ts';
import type { BulkDeleteResult, CreateCustomerInput, EditCustomerInput, EditResult, ResolvedRep, UndoDeleteResult } from './coreTypes.ts';

/** PATCH /api/customers/:id/quick-note. null = no such customer. */
export async function setQuickNote(id: string, quickNote: unknown): Promise<{ quickNote: string } | null> {
  const customer = await Customer.findByIdAndUpdate(id, { quickNote }, { new: true });
  return customer ? { quickNote: customer.quickNote } : null;
}

/**
 * A rep id → the { salesRep, salesRepName } pair a customer stores. An empty or unknown
 * id clears both (that is how an account is handed back).
 */
export async function resolveSalesRep(salesRepId: unknown): Promise<ResolvedRep> {
  if (!salesRepId) return { salesRep: null, salesRepName: '' };
  if (!mongoose.Types.ObjectId.isValid(salesRepId as string)) return { salesRep: null, salesRepName: '' };
  const rep = await User.findById(salesRepId).select('username displayName').lean();
  return rep
    ? { salesRep: rep._id, salesRepName: displayNameOf(rep) }
    : { salesRep: null, salesRepName: '' };
}

/** POST /api/customers. Throws what Mongoose throws (validation, duplicate email 11000). */
export async function createCustomer(input: CreateCustomerInput) {
  const newCustomer = new Customer({ _id: input.id, ...input.fields, ...input.rep, ...input.geo, createdBy: input.createdBy });
  await newCustomer.save();
  return newCustomer;
}

/** PUT /api/customers/:id. */
export async function editCustomer(id: string, input: EditCustomerInput): Promise<EditResult> {
  const updateData: Loose = { ...input.updateData };

  // Only touch the rep when the edit actually carried one.
  if (input.salesRep !== undefined) {
    Object.assign(updateData, await resolveSalesRep(input.salesRep));
  }

  const existing = await Customer.findById(id).select('address geocode').lean();
  if (!existing) return { notFound: true };

  if (input.address) {
    updateData.address = input.address;
  } else if (input.city) {
    updateData.address = { ...existing.address, city: input.city };
  }

  if (updateData.address) {
    const geo = await input.geocode(updateData.address, existing.geocode?.addressKey || '');
    if (geo) Object.assign(updateData, geo);
  }

  // A typed Moda display / binders is the new total (src/utils/modaTotals.ts).
  if (updateData.modaDisplay !== undefined || updateData.modaBinder !== undefined) {
    const moda = await Customer.findById(id)
      .select('modaDisplay modaBinder modaEarlier resources.resourceType resources.title resources.qty resources.status').lean();
    const typed = typedModaFields(moda || {}, { modaDisplay: updateData.modaDisplay, modaBinder: updateData.modaBinder },
      (moda as Loose)?.resources, await loadFamilies());
    if ('error' in typed) return { error: typed.error };
    delete updateData.modaDisplay;
    delete updateData.modaBinder;
    if (typed.fields) Object.assign(updateData, typed.fields);
  }

  const updatedCustomer = await Customer.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
  if (!updatedCustomer) return { notFound: true };
  return { customer: updatedCustomer };
}

/** PATCH /api/customers/bulk. `ids` are valid record ids; `update` is only status and / or the rep pair. */
export async function bulkUpdateCustomers(ids: string[], update: Loose): Promise<{ matched: number; modified: number }> {
  const result = await Customer.updateMany({ _id: { $in: ids } }, { $set: update });
  return { matched: result.matchedCount, modified: result.modifiedCount };
}

/** PATCH /api/customers/:id/active. false = no such customer. Throws on a value Mongoose can't cast. */
export async function setCustomerActive(id: string, isActive: unknown): Promise<boolean> {
  const customer = await Customer.findByIdAndUpdate(id, { isActive }, { new: true });
  return !!customer;
}

/**
 * A user was renamed: the customers they own carry the old name as a copy.
 * Returns how many customers were relabelled.
 */
export async function renameRepOnCustomers(userId: unknown, nameAfter: string): Promise<number> {
  const { modifiedCount } = await Customer.updateMany({ salesRep: userId as string }, { $set: { salesRepName: nameAfter } });
  return modifiedCount;
}


/* ---- Delete, bulk delete and Undo (saved whole to customerdeletebackups first) ---- */

/**
 * Delete one customer, saving it whole first (source 'single'). Returns the saved
 * copy's batch id, or null when there was no such customer.
 */
export async function backupAndDeleteCustomer(id: string, deletedBy = '', source = 'single'): Promise<string | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const raw = await Customer.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
  if (!raw) return null;
  const batchId = new mongoose.Types.ObjectId().toString();
  await CustomerDeleteBackup.create({ batchId, customerId: raw._id, customer: raw, source, deletedBy });
  await Customer.collection.deleteOne({ _id: raw._id });
  return batchId;
}

/** POST /bulk-delete. null = none of them exist. */
export async function bulkDeleteCustomers(ids: string[], deletedBy: string): Promise<BulkDeleteResult | null> {
  const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
  const docs = await Customer.collection.find({ _id: { $in: oids } }).toArray();
  if (docs.length === 0) return null;

  const batchId = new mongoose.Types.ObjectId().toString();
  await CustomerDeleteBackup.insertMany(
    docs.map((customer) => ({ batchId, customerId: customer._id, customer, source: 'bulk', deletedBy }))
  );
  const { deletedCount } = await Customer.collection.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  return { deleted: deletedCount, missing: ids.length - docs.length, batchId };
}

/** POST /bulk-delete/undo. null = this delete has already been undone. */
export async function undoBulkDelete(batchId: string, undoneBy: string): Promise<UndoDeleteResult | null> {
  const backups = await CustomerDeleteBackup.find({ batchId, undoneAt: null }).lean();
  if (backups.length === 0) return null;

  // Put them all back; one that clashes (still there, or its email taken
  // since) fails alone and the rest go in.
  try {
    await Customer.collection.insertMany(backups.map((b) => b.customer), { ordered: false });
  } catch (err) {
    if (!Array.isArray((err as Error & Loose).writeErrors) && !(err as Error & Loose).result) throw err;
  }

  // What's there now is back — restored just now, or never deleted.
  const ids = backups.map((b) => b.customerId);
  const present = new Set(
    (await Customer.collection.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
  );
  const back = backups.filter((b) => present.has(String(b.customerId)));
  const failed = backups
    .filter((b) => !present.has(String(b.customerId)))
    .map((b) => ({ id: String(b.customerId), company: String(b.customer?.company || b.customer?.contactName || '') }));

  if (back.length) {
    await CustomerDeleteBackup.updateMany(
      { _id: { $in: back.map((b) => b._id) } },
      { $set: { undoneAt: new Date(), undoneBy } }
    );
  }
  return { restored: back.length, failed };
}
