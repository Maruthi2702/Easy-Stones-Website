/**
 * Folding one customer record into another — shared by the import screen's
 * duplicate buttons (server.js) and scripts/merge-duplicate-customers.js, so
 * "merge" means the same thing wherever it's done.
 *
 * Works on the raw collections (mongoose.connection.db) rather than the
 * models: it moves ids across four other collections that don't agree on how
 * they store one (see REFERENCES), and restores whole documents on undo.
 *
 * Every write is preceded by snapshotMerge, whose result is everything undoMerge
 * needs to put it all back — the script writes it to a file, the server to the
 * customermergebackups collection.
 */
import mongoose from 'mongoose';
import { companyKey, phoneKey, isPlaceholderEmail, isFillerName } from '../utils/customerMatch.js';

/**
 * Where a customer id can be referenced. `deliveries` is the trap: it stores the
 * id as a String while every other collection stores an ObjectId, so a single
 * $in query over ObjectIds silently misses every delivery ever booked.
 */
export const REFERENCES = [
  { collection: 'schedules',    field: 'customerId', type: 'objectId' },
  { collection: 'activitylogs', field: 'customerId', type: 'objectId' },
  { collection: 'lostsales',    field: 'customerId', type: 'either' },
  { collection: 'deliveries',   field: 'customerId', type: 'string' }
];

const oid = (id) => new mongoose.Types.ObjectId(String(id));

export const idFilter = (ref, id) => {
  if (ref.type === 'string') return { [ref.field]: String(id) };
  if (ref.type === 'either') return { [ref.field]: { $in: [oid(id), String(id)] } };
  return { [ref.field]: oid(id) };
};
export const idValue = (ref, id) => (ref.type === 'string' ? String(id) : oid(id));

// ── choosing the values ──────────────────────────────────────────────────────

const better = {
  // A real address beats an invented one, and any address beats none.
  email: (survivor, loser) =>
    (!survivor || isPlaceholderEmail(survivor)) && loser && !isPlaceholderEmail(loser) ? loser : null,
  contactName: (survivor, loser) => (isFillerName(survivor) && !isFillerName(loser) ? loser : null),
  company: (survivor, loser) => (!companyKey(survivor) && companyKey(loser) ? loser : null),
  phone: (survivor, loser) => (!phoneKey(survivor) && phoneKey(loser) ? loser : null)
};

const ADDRESS_PARTS = ['street', 'city', 'state', 'zipCode'];

/** What the survivor should end up holding, and why — computed, not written. */
export const planFields = (survivor, losers) => {
  const changes = [];
  const set = {};

  for (const [field, pick] of Object.entries(better)) {
    for (const loser of losers) {
      const candidate = pick(set[field] ?? survivor[field], loser[field]);
      if (candidate) {
        set[field] = candidate;
        changes.push(`${field}: ${JSON.stringify(survivor[field] || '')} → ${JSON.stringify(candidate)}`);
        break;
      }
    }
  }

  for (const part of ADDRESS_PARTS) {
    if (String(survivor.address?.[part] || '').trim()) continue;
    const from = losers.find(l => String(l.address?.[part] || '').trim());
    if (from) {
      set[`address.${part}`] = from.address[part];
      changes.push(`address.${part}: (blank) → ${JSON.stringify(from.address[part])}`);
    }
  }

  // The owning rep is two fields that have to move together: the reference and
  // the name cached beside it. Taking them independently could pair one record's
  // rep id with another record's name, leaving the customer list showing a rep
  // the profile disagrees with. Handled here rather than in `better` for that
  // reason — and only when the survivor has no owner, so a merge never
  // reassigns an account that already belongs to someone.
  if (!survivor.salesRep) {
    const from = losers.find(l => l.salesRep);
    if (from) {
      set.salesRep = from.salesRep;
      set.salesRepName = from.salesRepName || '';
      changes.push(`salesRep: (unassigned) → ${JSON.stringify(from.salesRepName || String(from.salesRep))}`);
    }
  }

  // Branch. Only filled when the survivor has none: every record was backfilled
  // to Seattle, so in practice this only matters for records created since.
  if (!String(survivor.location || '').trim()) {
    const from = losers.find(l => String(l.location || '').trim());
    if (from) {
      set.location = from.location;
      changes.push(`location: (blank) → ${JSON.stringify(from.location)}`);
    }
  }

  return { set, changes };
};

/**
 * Anything on the loser that has nowhere else to go becomes a contact, so a
 * second real person at the business is not thrown away with the record.
 */
export const contactsFromLosers = (finalEmail, survivor, losers) => {
  const known = new Set([
    String(finalEmail || '').toLowerCase(),
    ...(survivor.contacts || []).map(c => String(c.email || '').toLowerCase())
  ].filter(Boolean));

  const extra = [];
  for (const loser of losers) {
    const email = String(loser.email || '').toLowerCase();
    const keepEmail = email && !isPlaceholderEmail(email) && !known.has(email);
    const keepName = !isFillerName(loser.contactName) &&
      String(loser.contactName).trim().toLowerCase() !== String(survivor.contactName || '').trim().toLowerCase();
    if (!keepEmail && !keepName) continue;
    known.add(email);
    extra.push({
      name: isFillerName(loser.contactName) ? '' : loser.contactName,
      email: keepEmail ? loser.email : '',
      phone: loser.phone || '',
      role: '',
      notes: `Kept from a duplicate record merged on ${new Date().toISOString().slice(0, 10)}`,
      createdAt: new Date().toISOString()
    });
  }
  return extra;
};

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Everything undoMerge needs, read before anything is written: the survivor
 * as it stands, the records about to be removed, and exactly which documents
 * in other collections point at them.
 */
export const snapshotMerge = async (db, survivor, losers) => {
  const customers = db.collection('customers');
  const moved = [];
  for (const loser of losers) {
    for (const ref of REFERENCES) {
      const docs = await db.collection(ref.collection)
        .find(idFilter(ref, loser._id), { projection: { _id: 1 } }).toArray();
      if (docs.length) moved.push({ ...ref, from: String(loser._id), ids: docs.map(d => String(d._id)) });
    }
    const pointing = await customers
      .find({ associatedCustomers: oid(loser._id) }, { projection: { _id: 1 } }).toArray();
    if (pointing.length) {
      moved.push({ collection: 'customers', field: 'associatedCustomers', type: 'objectId', from: String(loser._id), ids: pointing.map(d => String(d._id)) });
    }
  }
  return { survivorId: String(survivor._id), survivorBefore: survivor, losers, moved };
};

/**
 * Remove `losers`, pointing everything that referenced them at `survivor`.
 *
 * With `copyDetails` (a merge), the survivor also takes the better values from
 * `set`, the losers' extra people as contacts, and their visits, resources and
 * associations. Without it (the import screen's "Delete"), the survivor is
 * left exactly as it was — but the history elsewhere still moves, because a
 * delivery or booking pointing at a deleted id resolves to nobody.
 */
export const executeMerge = async (db, survivor, losers, { set = {}, newContacts = [], copyDetails = true } = {}) => {
  const customers = db.collection('customers');
  const survivorId = oid(survivor._id);

  // 1. Move the history over first, so nothing is orphaned even if a later step fails.
  for (const loser of losers) {
    for (const ref of REFERENCES) {
      await db.collection(ref.collection)
        .updateMany(idFilter(ref, loser._id), { $set: { [ref.field]: idValue(ref, survivorId) } });
    }

    // Customers that listed the duplicate as an associate should now list the
    // survivor. Read who they are before the $pull removes the evidence, and
    // never let the survivor end up associated with itself.
    const loserOid = oid(loser._id);
    const pointingIds = (await customers
      .find({ associatedCustomers: loserOid }, { projection: { _id: 1 } }).toArray())
      .map(d => d._id)
      .filter(id => String(id) !== String(survivorId));

    // Two steps: one update cannot $pull and $addToSet the same array.
    await customers.updateMany({ associatedCustomers: loserOid }, { $pull: { associatedCustomers: loserOid } });
    if (pointingIds.length) {
      await customers.updateMany({ _id: { $in: pointingIds } }, { $addToSet: { associatedCustomers: survivorId } });
    }
  }

  // 2. Remove the duplicates, freeing their email addresses before the survivor claims one.
  await customers.deleteMany({ _id: { $in: losers.map(l => oid(l._id)) } });

  if (!copyDetails) return;

  // 3. Give the survivor the better values and anything worth keeping.
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  const push = {};
  if (newContacts.length) push.contacts = { $each: newContacts };
  const extraVisits = losers.flatMap(l => l.visits || []);
  const extraResources = losers.flatMap(l => l.resources || []);
  if (extraVisits.length) push.visits = { $each: extraVisits };
  if (extraResources.length) push.resources = { $each: extraResources };
  if (Object.keys(push).length) update.$push = push;

  const extraAssoc = [...new Set(losers.flatMap(l => (l.associatedCustomers || []).map(String)))]
    .filter(id => id !== String(survivorId))
    .map(id => oid(id));
  if (extraAssoc.length) update.$addToSet = { associatedCustomers: { $each: extraAssoc } };

  if (Object.keys(update).length) await customers.updateOne({ _id: survivorId }, update);
};

/** Put one snapshotMerge result back: removed records, their references, the survivor's old values. */
export const undoMerge = async (db, group) => {
  const customers = db.collection('customers');

  // Put the removed records back before restoring references to them.
  for (const loser of group.losers) {
    const doc = { ...loser, _id: oid(loser._id) };
    await customers.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  for (const m of group.moved) {
    const ids = m.ids.map(id => oid(id));
    if (m.collection === 'customers') {
      await customers.updateMany({ _id: { $in: ids } }, { $pull: { associatedCustomers: oid(group.survivorId) } });
      await customers.updateMany({ _id: { $in: ids } }, { $addToSet: { associatedCustomers: oid(m.from) } });
    } else {
      await db.collection(m.collection).updateMany({ _id: { $in: ids } }, { $set: { [m.field]: idValue(m, m.from) } });
    }
  }
  const before = { ...group.survivorBefore, _id: oid(group.survivorId) };
  await customers.replaceOne({ _id: before._id }, before);
};

/**
 * Mark every pair in `ids` as different businesses, on both customers, so
 * withoutSeparated (src/utils/customerMatch.js) stops grouping them.
 */
export const markSeparate = async (db, ids) => {
  const customers = db.collection('customers');
  for (const id of ids) {
    const others = ids.filter(o => String(o) !== String(id)).map(o => oid(o));
    if (others.length) {
      await customers.updateOne({ _id: oid(id) }, { $addToSet: { notDuplicateOf: { $each: others } } });
    }
  }
};
