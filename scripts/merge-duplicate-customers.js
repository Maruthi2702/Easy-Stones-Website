/**
 * Merge customer records that are the same business twice.
 *
 *   node scripts/merge-duplicate-customers.js                 # dry run, prints the plan
 *   node scripts/merge-duplicate-customers.js --apply         # do it, after writing a backup
 *   node scripts/merge-duplicate-customers.js --only "olympic" # one group
 *   node scripts/merge-duplicate-customers.js --include-weak  # also single-signal groups
 *   node scripts/merge-duplicate-customers.js --undo <backup.json>
 *
 * Groups come from src/utils/customerMatch.js, the same matcher the audit uses,
 * so what the audit calls a duplicate is exactly what this merges. By default
 * only groups where two independent signals agree are touched; a shared email
 * domain alone is four branches of a dealer, not four copies of one customer.
 *
 * WHY THE LOSER IS DELETED RATHER THAN FLAGGED
 * Customer lists query with no isActive filter (server.js), so a record marked
 * inactive would still appear in every dropdown and the duplicate would not
 * actually be gone. The record is therefore removed — but every document this
 * script touches is written to scripts/merge-backups/ first, and --undo puts it
 * all back.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { groupDuplicates, companyKey, phoneKey, isPlaceholderEmail, isFillerName, STRONG }
  from '../src/utils/customerMatch.js';

dotenv.config();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(HERE, 'merge-backups');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const APPLY = has('--apply');
const INCLUDE_WEAK = has('--include-weak');
const FIX_ORPHANS = has('--fix-orphans');
const ONLY = valueOf('--only');
const UNDO = valueOf('--undo');

/**
 * Where a customer id can be referenced. `deliveries` is the trap: it stores the
 * id as a String while every other collection stores an ObjectId, so a single
 * $in query over ObjectIds silently misses every delivery ever booked.
 */
const REFERENCES = [
  { collection: 'schedules',    field: 'customerId', type: 'objectId' },
  { collection: 'activitylogs', field: 'customerId', type: 'objectId' },
  { collection: 'lostsales',    field: 'customerId', type: 'either' },
  { collection: 'deliveries',   field: 'customerId', type: 'string' }
];

const idFilter = (ref, id) => {
  const oid = new mongoose.Types.ObjectId(String(id));
  if (ref.type === 'string') return { [ref.field]: String(id) };
  if (ref.type === 'either') return { [ref.field]: { $in: [oid, String(id)] } };
  return { [ref.field]: oid };
};
const idValue = (ref, id) => (ref.type === 'string' ? String(id) : new mongoose.Types.ObjectId(String(id)));

// ── choosing the survivor ────────────────────────────────────────────────────

/**
 * History is the thing that cannot be recreated. A record with visits, bookings
 * and deliveries against it keeps its id; the other record's *values* may still
 * be better, and get copied over below.
 */
const weigh = async (db, row) => {
  const counts = {};
  for (const ref of REFERENCES) {
    counts[ref.collection] = await db.collection(ref.collection).countDocuments(idFilter(ref, row._id));
  }
  counts.pointedAt = await db.collection('customers')
    .countDocuments({ associatedCustomers: new mongoose.Types.ObjectId(String(row._id)) });
  counts.visits = (row.visits || []).length;
  counts.contacts = (row.contacts || []).length;
  counts.resources = (row.resources || []).length;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
};

const describeHistory = (w) =>
  Object.entries(w.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ') || 'no history';

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
const planFields = (survivor, losers) => {
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
const contactsFromLosers = (finalEmail, survivor, losers) => {
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

// ── the plan ─────────────────────────────────────────────────────────────────

const buildPlan = async (db) => {
  const rows = await db.collection('customers').find({}).toArray();
  const byId = new Map(rows.map(r => [String(r._id), r]));

  let groups = groupDuplicates(rows).filter(g => (INCLUDE_WEAK ? true : g.score >= STRONG));
  if (ONLY) {
    const needle = ONLY.toLowerCase();
    groups = groups.filter(g => g.ids.some(id => String(byId.get(id)?.company || '').toLowerCase().includes(needle)));
  }

  const plan = [];
  for (const group of groups) {
    const members = group.ids.map(id => byId.get(id)).filter(Boolean);
    if (members.length < 2) continue;

    const weighed = [];
    for (const m of members) weighed.push({ row: m, weight: await weigh(db, m) });

    // Most history wins; a tie goes to the older record, which is the one the
    // team has been using.
    weighed.sort((a, b) => b.weight.total - a.weight.total ||
      new Date(a.row.createdAt) - new Date(b.row.createdAt));

    const survivor = weighed[0].row;
    const losers = weighed.slice(1).map(w => w.row);
    const { set, changes } = planFields(survivor, losers);
    const newContacts = contactsFromLosers(set.email ?? survivor.email, survivor, losers);

    const moves = [];
    for (const loser of losers) {
      for (const ref of REFERENCES) {
        const n = await db.collection(ref.collection).countDocuments(idFilter(ref, loser._id));
        if (n) moves.push({ ...ref, from: String(loser._id), count: n });
      }
      const pointing = await db.collection('customers')
        .countDocuments({ associatedCustomers: new mongoose.Types.ObjectId(String(loser._id)) });
      if (pointing) moves.push({ collection: 'customers', field: 'associatedCustomers', type: 'objectId', from: String(loser._id), count: pointing });
    }

    plan.push({ group, weighed, survivor, losers, set, changes, newContacts, moves });
  }
  return plan;
};

const printPlan = (plan) => {
  if (!plan.length) {
    console.log('\nNothing to merge.');
    return;
  }
  for (const [i, p] of plan.entries()) {
    console.log(`\n${'─'.repeat(74)}`);
    console.log(`${i + 1}. ${p.survivor.company}   (matched on ${p.group.signals.join(', ')})`);
    for (const w of p.weighed) {
      const role = w.row === p.survivor ? 'KEEP  ' : 'REMOVE';
      console.log(`   ${role} ${String(w.row._id)}  ${w.row.company} — ${w.row.contactName} — ${w.row.email}`);
      console.log(`          created ${new Date(w.row.createdAt).toISOString().slice(0, 10)} · ${describeHistory(w.weight)}`);
    }
    if (p.changes.length) {
      console.log('   fields filled in on the kept record:');
      p.changes.forEach(c => console.log(`     · ${c}`));
    }
    if (p.newContacts.length) {
      console.log(`   kept as contacts: ${p.newContacts.map(c => c.name || c.email).join(', ')}`);
    }
    if (p.moves.length) {
      console.log('   history moved across:');
      p.moves.forEach(m => console.log(`     · ${m.count} ${m.collection}.${m.field}`));
    } else {
      console.log('   history moved across: none — the removed record has no history');
    }
  }
  console.log(`\n${'─'.repeat(74)}`);
  console.log(`${plan.length} group(s), ${plan.reduce((n, p) => n + p.losers.length, 0)} record(s) would be removed.`);
};

// ── history left behind by a deletion ────────────────────────────────────────

/**
 * A customer deleted by hand takes no references with it, so bookings made
 * against it stop resolving to anybody. Deliveries also store the customer's
 * name, which is enough to put them back — schedules and activity logs store
 * only the id, so those can be reported but not repaired.
 */
const buildOrphanPlan = async (db) => {
  const customers = await db.collection('customers').find({}, { projection: { company: 1 } }).toArray();
  const liveIds = new Set(customers.map(c => String(c._id)));

  const byName = new Map();
  for (const c of customers) {
    const k = companyKey(c.company);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }

  const repairable = [];
  const unresolved = [];

  for (const ref of REFERENCES) {
    const rows = await db.collection(ref.collection)
      .find({ [ref.field]: { $nin: [null, ''] } },
        { projection: { [ref.field]: 1, customerName: 1, deliveryDate: 1, status: 1 } }).toArray();

    for (const row of rows) {
      const current = String(row[ref.field] || '');
      if (!current || liveIds.has(current)) continue;

      const matches = byName.get(companyKey(row.customerName)) || [];
      if (matches.length === 1) {
        repairable.push({
          ...ref,
          docId: String(row._id),
          name: row.customerName,
          when: row.deliveryDate || '',
          status: row.status || '',
          from: current,
          to: String(matches[0]._id),
          toCompany: matches[0].company
        });
      } else {
        unresolved.push({
          ...ref,
          docId: String(row._id),
          name: row.customerName || '(no name stored)',
          from: current,
          why: matches.length ? `${matches.length} customers share that name` : 'no surviving customer of that name'
        });
      }
    }
  }
  return { repairable, unresolved };
};

const printOrphans = ({ repairable, unresolved }) => {
  console.log(`\n${'='.repeat(74)}`);
  console.log('HISTORY POINTING AT A DELETED CUSTOMER');
  console.log('='.repeat(74));

  if (!repairable.length && !unresolved.length) {
    console.log('\n  None — every booking resolves to a customer.');
    return;
  }
  if (repairable.length) {
    console.log(`\n  Can be put back — the stored name matches exactly one customer: ${repairable.length}`);
    repairable.forEach(o => console.log(
      `     · ${o.collection}: ${o.name}${o.when ? ` [${o.when}]` : ''}${o.status ? ` ${o.status}` : ''}\n` +
      `         ${o.from} → ${o.to}  (${o.toCompany})`));
  }
  if (unresolved.length) {
    console.log(`\n  Cannot be resolved automatically: ${unresolved.length}`);
    unresolved.forEach(o => console.log(`     · ${o.collection} ${o.docId}: ${o.name} — ${o.why}`));
  }
};

const applyOrphanFixes = async (db, repairable) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `orphans-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), orphans: repairable }, null, 2));
  console.log(`\nBackup written: ${file}`);

  for (const o of repairable) {
    await db.collection(o.collection).updateOne(
      { _id: new mongoose.Types.ObjectId(o.docId) },
      { $set: { [o.field]: idValue(o, o.to) } }
    );
    console.log(`  repointed: ${o.collection} — ${o.name} → ${o.toCompany}`);
  }
  console.log(`\nDone. To reverse: node scripts/merge-duplicate-customers.js --undo ${file}`);
};

// ── writing ──────────────────────────────────────────────────────────────────

const applyPlan = async (db, plan) => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `merge-${stamp}.json`);

  const backup = { createdAt: new Date().toISOString(), groups: [] };
  for (const p of plan) {
    const moved = [];
    for (const loser of p.losers) {
      for (const ref of REFERENCES) {
        const docs = await db.collection(ref.collection)
          .find(idFilter(ref, loser._id), { projection: { _id: 1 } }).toArray();
        if (docs.length) moved.push({ ...ref, from: String(loser._id), ids: docs.map(d => String(d._id)) });
      }
      const pointing = await db.collection('customers')
        .find({ associatedCustomers: new mongoose.Types.ObjectId(String(loser._id)) }, { projection: { _id: 1 } }).toArray();
      if (pointing.length) moved.push({ collection: 'customers', field: 'associatedCustomers', type: 'objectId', from: String(loser._id), ids: pointing.map(d => String(d._id)) });
    }
    backup.groups.push({
      survivorId: String(p.survivor._id),
      survivorBefore: p.survivor,
      losers: p.losers,
      moved,
      addedContacts: p.newContacts.length
    });
  }
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  const customers = db.collection('customers');
  for (const p of plan) {
    const survivorId = new mongoose.Types.ObjectId(String(p.survivor._id));

    // 1. Move the history over first, so nothing is orphaned even if a later step fails.
    for (const loser of p.losers) {
      for (const ref of REFERENCES) {
        await db.collection(ref.collection)
          .updateMany(idFilter(ref, loser._id), { $set: { [ref.field]: idValue(ref, survivorId) } });
      }

      // Customers that listed the duplicate as an associate should now list the
      // survivor. Read who they are before the $pull removes the evidence, and
      // never let the survivor end up associated with itself.
      const loserOid = new mongoose.Types.ObjectId(String(loser._id));
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
    await customers.deleteMany({ _id: { $in: p.losers.map(l => new mongoose.Types.ObjectId(String(l._id))) } });

    // 3. Give the survivor the better values and anything worth keeping.
    const update = {};
    if (Object.keys(p.set).length) update.$set = p.set;
    const push = {};
    if (p.newContacts.length) push.contacts = { $each: p.newContacts };
    const extraVisits = p.losers.flatMap(l => l.visits || []);
    const extraResources = p.losers.flatMap(l => l.resources || []);
    if (extraVisits.length) push.visits = { $each: extraVisits };
    if (extraResources.length) push.resources = { $each: extraResources };
    if (Object.keys(push).length) update.$push = push;

    const extraAssoc = [...new Set(p.losers.flatMap(l => (l.associatedCustomers || []).map(String)))]
      .filter(id => id !== String(survivorId))
      .map(id => new mongoose.Types.ObjectId(id));
    if (extraAssoc.length) update.$addToSet = { associatedCustomers: { $each: extraAssoc } };

    if (Object.keys(update).length) await customers.updateOne({ _id: survivorId }, update);
    console.log(`  merged: ${p.survivor.company}  (${p.losers.length} removed)`);
  }

  console.log(`\nDone. To reverse: node scripts/merge-duplicate-customers.js --undo ${backupPath}`);
};

const undo = async (db, file) => {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const customers = db.collection('customers');

  for (const o of backup.orphans || []) {
    await db.collection(o.collection).updateOne(
      { _id: new mongoose.Types.ObjectId(o.docId) },
      { $set: { [o.field]: idValue(o, o.from) } }
    );
    console.log(`  reverted: ${o.collection} — ${o.name} back to ${o.from}`);
  }

  for (const g of backup.groups || []) {
    // Put the removed records back before restoring references to them.
    for (const loser of g.losers) {
      const doc = { ...loser, _id: new mongoose.Types.ObjectId(String(loser._id)) };
      await customers.replaceOne({ _id: doc._id }, doc, { upsert: true });
    }
    for (const m of g.moved) {
      const ids = m.ids.map(id => new mongoose.Types.ObjectId(id));
      if (m.collection === 'customers') {
        await customers.updateMany({ _id: { $in: ids } },
          { $pull: { associatedCustomers: new mongoose.Types.ObjectId(g.survivorId) } });
        await customers.updateMany({ _id: { $in: ids } },
          { $addToSet: { associatedCustomers: new mongoose.Types.ObjectId(m.from) } });
      } else {
        await db.collection(m.collection).updateMany({ _id: { $in: ids } },
          { $set: { [m.field]: idValue(m, m.from) } });
      }
    }
    const before = { ...g.survivorBefore, _id: new mongoose.Types.ObjectId(g.survivorId) };
    await customers.replaceOne({ _id: before._id }, before);
    console.log(`  restored: ${before.company}  (${g.losers.length} records back)`);
  }
  console.log('\nUndo complete.');
};

// ── run ──────────────────────────────────────────────────────────────────────

mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/easy-stones')
  .then(async () => {
    const db = mongoose.connection.db;

    if (UNDO) {
      await undo(db, UNDO);
      return mongoose.disconnect();
    }

    if (FIX_ORPHANS) {
      const orphans = await buildOrphanPlan(db);
      printOrphans(orphans);
      if (!APPLY) {
        console.log('\nDry run — nothing was written. Add --apply to carry this out.');
      } else if (orphans.repairable.length) {
        await applyOrphanFixes(db, orphans.repairable);
      }
      return mongoose.disconnect();
    }

    const plan = await buildPlan(db);
    printPlan(plan);

    if (!APPLY) {
      console.log('\nDry run — nothing was written. Add --apply to carry this out.');
    } else if (plan.length) {
      await applyPlan(db, plan);
    }

    await mongoose.disconnect();
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
