/**
 * Customer saves on Postgres. Each writes what the copy would make of the MongoDB
 * record after the same save (src/db/copy/customerRows.ts), and answers what its
 * MongoDB twin in core.mongo.ts answers (core.parity.test.ts proves both).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../copy/plan.ts';
import { customers, customerDeleteBackups } from '../../schema/customers.ts';
import { newId } from '../../ids.ts';
import { removeCustomerWithBackup, restoreCustomerFromBackup } from './customerRemoval.postgres.ts';
import Customer from '../../../models/Customer.ts';
import type { Loose } from '../../../types/records.ts';
import { customerRows } from '../../copy/customerRows.ts';
import type { CopyProblem } from '../../copy/values.ts';
import { resourceTypes } from '../../schema/reference.ts';
import { familyLookup, typedModaFields } from '../../../utils/modaTotals.ts';
import type { BulkDeleteResult, CreateCustomerInput, EditCustomerInput, EditResult, ResolvedRep, UndoDeleteResult } from './coreTypes.ts';
import {
  idForQuery, referenceIndexOf, resolveSalesRep as resolveRep, loadCustomerRecord
} from './coreSupport.postgres.ts';

/**
 * Mongoose casts a quick note to text; a list or an object is refused (the route
 * answers 500, as it always has). null / undefined store nothing ('' here: the copy's
 * value for a missing note).
 */
function noteText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') throw new Error('Cast to string failed for quickNote');
  return String(value);
}

/** PATCH /api/customers/:id/quick-note. null = no such customer. */
export async function setQuickNote(db: Db, id: string, quickNote: unknown): Promise<{ quickNote: string } | null> {
  const [row] = await db.update(customers)
    .set({ quickNote: noteText(quickNote), updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning({ quickNote: customers.quickNote });
  return row ?? null;
}

/* ---------------------------------------------------------------------------------
 * Create, edit, bulk, active, rep rename. Each writes what the copy would make of the
 * MongoDB record after the same save: the row is built by the copy's own builder
 * (customerRows), so a column can't drift from it. Mongoose is used here only as the
 * rule book (casting, defaults, enums, lowercase email), never to reach a database.
 * ------------------------------------------------------------------------------- */
export const resolveSalesRep = (db: Db, salesRepId: unknown): Promise<ResolvedRep> => resolveRep(db, salesRepId);

/** What MongoDB answers when a second customer takes an email (the create route turns code 11000 into its message). */
const duplicateEmail = (email: string) =>
  Object.assign(new Error(`E11000 duplicate key error collection: customers index: email_1 dup key: { email: "${email}" }`), { code: 11000 });

const isUniqueViolation = (e: unknown): boolean => {
  for (let x = e as { code?: string; cause?: unknown } | undefined; x; x = x.cause as typeof x) if (x.code === '23505') return true;
  return false;
};

/** The branch a customer falls back to when the one named isn't a Location (the model's own default). */
const FALLBACK_BRANCH = 'Seattle';

/**
 * The customers row the copy would make of this MongoDB-shaped record (no visits, resources,
 * contacts or links). A branch that isn't a Location can't be stored (the row points at a
 * location): MongoDB keeps the typed name, Postgres files the customer under Seattle
 * (`location` in the result says where) and the typed name is lost.
 */
async function customerRowOf(db: Db, record: Loose) {
  const { visits: _v, resources: _r, contacts: _c, associatedCustomers: _a, notDuplicateOf: _n, ...own } = record;
  const ref = await referenceIndexOf(db);
  const asked = String(own.location ?? '').trim();
  let location = asked;
  if (!ref.locationIdByName.has(asked) && ref.locationIdByName.has(FALLBACK_BRANCH)) location = FALLBACK_BRANCH;
  const problems: CopyProblem[] = [];
  const { rows } = customerRows([{ ...own, location }], ref, problems);
  const row = rows.customers[0];
  if (!row) {
    const why = problems.find(p => p.outcome === 'skipped');
    throw new Error(why?.field === 'location_id'
      ? `"${asked}" is not one of the branches (Locations).`
      : `The customer can't be saved: ${why?.reason ?? 'unknown reason'}.`);
  }
  return { row, login: rows.customerLogins[0] ?? null, location };
}

/** POST /api/customers. */
export async function createCustomer(db: Db, input: CreateCustomerInput) {
  // The same document MongoDB would save: Mongoose's own casting and defaults, its own errors.
  const doc = new Customer({ _id: input.id, ...input.fields, ...input.rep, ...input.geo, createdBy: input.createdBy });
  await doc.validate();
  const now = new Date();
  doc.createdAt = now;
  doc.updatedAt = now;
  const { row, location } = await customerRowOf(db, doc.toObject({ virtuals: false }) as Loose);
  if (location !== doc.location) doc.location = location; // an unknown branch is filed under the fallback

  try {
    await db.transaction(async tx => {
      const [taken] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.email, row.email));
      if (taken) throw duplicateEmail(row.email);
      await tx.insert(customers).values(row);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicateEmail(row.email);
    throw e;
  }
  return doc;
}

/**
 * Mongoose's own cast and validation of an edit's update (what findByIdAndUpdate does with
 * `runValidators`), without a database: the same casts and the same error messages.
 * Uses Query internals (mongoose is pinned); the parity tests fail if an upgrade changes them.
 */
async function castUpdate(id: string, update: Loose): Promise<Loose> {
  const query = Customer.findByIdAndUpdate(id, update, { new: true, runValidators: true }) as unknown as Loose;
  const casted = query._castUpdate(query.getUpdate());
  if (casted instanceof Error) throw casted;
  await query.validate(casted, query._optionsForExec(Customer), false);
  return (casted?.$set ?? {}) as Loose;
}

/** Applies a cast `$set` to a record: a name replaces the whole value, a dotted one reaches into it. */
function applySet(record: Loose, set: Loose): Loose {
  const next: Loose = { ...record };
  for (const [path, value] of Object.entries(set)) {
    const parts = path.split('.');
    if (['visits', 'resources', 'contacts'].includes(parts[0])) continue;
    let at = next;
    for (const part of parts.slice(0, -1)) { at[part] = { ...(at[part] ?? {}) }; at = at[part]; }
    at[parts[parts.length - 1]] = value;
  }
  return next;
}

/** PUT /api/customers/:id. */
export async function editCustomer(db: Db, rawId: string, input: EditCustomerInput): Promise<EditResult> {
  const id = idForQuery(rawId);
  const updateData: Loose = { ...input.updateData };

  if (input.salesRep !== undefined) Object.assign(updateData, await resolveRep(db, input.salesRep));

  const existing = await loadCustomerRecord(db, id);
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

  if (updateData.modaDisplay !== undefined || updateData.modaBinder !== undefined) {
    const families = familyLookup(await db.select({ name: resourceTypes.name, family: resourceTypes.family }).from(resourceTypes));
    const typed = typedModaFields(existing, { modaDisplay: updateData.modaDisplay, modaBinder: updateData.modaBinder },
      existing.resources, families);
    if ('error' in typed) return { error: typed.error };
    delete updateData.modaDisplay;
    delete updateData.modaBinder;
    if (typed.fields) Object.assign(updateData, typed.fields);
  }

  const set = await castUpdate(id, updateData);
  const now = new Date();
  const next = applySet(existing, { ...set, updatedAt: now });
  const { row, location } = await customerRowOf(db, next);
  next.location = location;

  try {
    await db.transaction(async tx => {
      const { id: _id, createdAt: _created, ...columns } = row;
      const [saved] = await tx.update(customers).set(columns).where(eq(customers.id, id)).returning({ id: customers.id });
      if (!saved) throw Object.assign(new Error('gone'), { notFound: true });
    });
  } catch (e) {
    if ((e as Loose)?.notFound) return { notFound: true };
    if (isUniqueViolation(e)) throw duplicateEmail(row.email);
    throw e;
  }
  return { customer: next };
}

/** PATCH /api/customers/bulk. `update` holds only status and / or salesRep (+ the name copy, which Postgres doesn't store). */
export async function bulkUpdateCustomers(db: Db, ids: string[], update: Loose): Promise<{ matched: number; modified: number }> {
  const wanted = ids.filter(i => HEX.test(i)).map(i => i.toLowerCase());
  const set: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
  if ('status' in update) set.status = String(update.status);
  if ('salesRep' in update) set.salesRepId = update.salesRep ? String(update.salesRep) : null;
  if (!wanted.length) return { matched: 0, modified: 0 };
  // Every matched customer's updatedAt moves, which is what makes MongoDB count it modified too.
  const done = await db.update(customers).set(set).where(inArray(customers.id, wanted)).returning({ id: customers.id });
  return { matched: done.length, modified: done.length };
}
const HEX = /^[0-9a-f]{24}$/i;

/** PATCH /api/customers/:id/active. false = no such customer. */
export async function setCustomerActive(db: Db, rawId: string, isActive: unknown): Promise<boolean> {
  const id = idForQuery(rawId);
  // Mongoose's boolean cast ('yes', 1, '0'…); a value it can't cast is refused, as MongoDB refuses it.
  const cast = (Customer.castObject({ isActive }) as Loose).isActive as boolean | null | undefined;
  const set: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
  // MongoDB stores null as null, which the copy reads as active.
  if (isActive === null) set.isActive = true;
  else if (cast !== undefined) set.isActive = cast ?? true;
  const done = await db.update(customers).set(set).where(eq(customers.id, id)).returning({ id: customers.id });
  return done.length > 0;
}

/**
 * A user was renamed. MongoDB keeps a copy of the rep's name on each customer and rewrites
 * it here; Postgres keeps none (the name is read from the user by a join), so there is
 * nothing to write — the new name shows everywhere at once. Returns how many customers
 * the rep owns, so the route still clears the caches that hold their names.
 */
export async function renameRepOnCustomers(db: Db, userId: unknown, _nameAfter: string): Promise<number> {
  const id = String(userId ?? '');
  if (!HEX.test(id)) return 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.salesRepId, id.toLowerCase()));
  return n;
}

/* ---- Delete, bulk delete and Undo ---- */

/** DELETE /api/customers/:id: the batch id of the saved copy, or null when there was no such customer. */
export async function backupAndDeleteCustomer(db: Db, id: string, deletedBy = '', source = 'single'): Promise<string | null> {
  if (!HEX.test(id)) return null;
  const batchId = newId();
  const done = await db.transaction(tx => removeCustomerWithBackup(tx, id.toLowerCase(), { batchId, deletedBy, source }));
  return done ? batchId : null;
}

/** POST /bulk-delete (valid ids, no repeats). null = none of them exist. */
export async function bulkDeleteCustomers(db: Db, ids: string[], deletedBy: string): Promise<BulkDeleteResult | null> {
  const wanted = ids.map(i => i.toLowerCase());
  const batchId = newId();
  return db.transaction(async tx => {
    const found = (await tx.select({ id: customers.id }).from(customers).where(inArray(customers.id, wanted))).map(r => r.id);
    if (!found.length) return null;
    for (const id of found) await removeCustomerWithBackup(tx, id, { batchId, deletedBy, source: 'bulk' });
    return { deleted: found.length, missing: wanted.length - found.length, batchId };
  });
}

/** POST /bulk-delete/undo. null = this delete has already been undone. */
export async function undoBulkDelete(db: Db, batchId: string, undoneBy: string): Promise<UndoDeleteResult | null> {
  return db.transaction(async tx => {
    const backups = await tx.select().from(customerDeleteBackups)
      .where(and(eq(customerDeleteBackups.batchId, batchId), isNull(customerDeleteBackups.undoneAt)));
    if (!backups.length) return null;

    // One that clashes (its email or SPS key was taken since) fails alone and the rest go in.
    // Newest delete first: a customer deleted after another is back before the other needs it.
    for (const b of [...backups].sort((x, y) => (x.id < y.id ? 1 : -1))) {
      if ((await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, b.customerId))).length) continue;
      try {
        await tx.transaction(sp => restoreCustomerFromBackup(sp, b.customer as Loose, b.customerId));
      } catch (e) {
        if (!isUniqueViolation(e) && !(e as Loose)?.cannotRestore) throw e;
      }
    }

    const present = new Set((await tx.select({ id: customers.id }).from(customers)
      .where(inArray(customers.id, backups.map(b => b.customerId)))).map(r => r.id));
    const back = backups.filter(b => present.has(b.customerId));
    const failed = backups.filter(b => !present.has(b.customerId))
      .map(b => ({ id: b.customerId, company: String((b.customer as Loose)?.company || (b.customer as Loose)?.contactName || '') }));
    if (back.length) {
      await tx.update(customerDeleteBackups).set({ undoneAt: new Date(), undoneBy, updatedAt: new Date() })
        .where(inArray(customerDeleteBackups.id, back.map(b => b.id)));
    }
    return { restored: back.length, failed };
  });
}
