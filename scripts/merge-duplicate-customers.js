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
import { groupDuplicates, companyKey, STRONG, withoutSeparated }
  from '../src/utils/customerMatch.js';
// The merge itself lives in src/services/customerMerge.js, shared with the
// import screen's Merge / Delete buttons, so the two can't drift apart.
import {
  REFERENCES, idFilter, idValue, planFields, contactsFromLosers,
  snapshotMerge, executeMerge, undoMerge
} from '../src/services/customerMerge.js';

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

// ── the plan ─────────────────────────────────────────────────────────────────

const buildPlan = async (db) => {
  const rows = await db.collection('customers').find({}).toArray();
  const byId = new Map(rows.map(r => [String(r._id), r]));

  // Customers someone marked as separate accounts on the import screen are
  // taken out of their group, so this never merges what a person said apart.
  const separatedFrom = new Map(rows.map(r => [String(r._id), new Set((r.notDuplicateOf || []).map(String))]));
  let groups = groupDuplicates(rows)
    .filter(g => (INCLUDE_WEAK ? true : g.score >= STRONG))
    .map(g => ({ ...g, ids: withoutSeparated(g.ids, separatedFrom) }))
    .filter(g => g.ids.length > 1);
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

  // Every group's snapshot is written before any group is touched.
  const backup = { createdAt: new Date().toISOString(), groups: [] };
  for (const p of plan) {
    const snap = await snapshotMerge(db, p.survivor, p.losers);
    backup.groups.push({ ...snap, addedContacts: p.newContacts.length });
  }
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup written: ${backupPath}`);

  for (const p of plan) {
    await executeMerge(db, p.survivor, p.losers, { set: p.set, newContacts: p.newContacts, copyDetails: true });
    console.log(`  merged: ${p.survivor.company}  (${p.losers.length} removed)`);
  }

  console.log(`\nDone. To reverse: node scripts/merge-duplicate-customers.js --undo ${backupPath}`);
};

const undo = async (db, file) => {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const o of backup.orphans || []) {
    await db.collection(o.collection).updateOne(
      { _id: new mongoose.Types.ObjectId(o.docId) },
      { $set: { [o.field]: idValue(o, o.from) } }
    );
    console.log(`  reverted: ${o.collection} — ${o.name} back to ${o.from}`);
  }

  for (const g of backup.groups || []) {
    await undoMerge(db, g);
    console.log(`  restored: ${g.survivorBefore.company}  (${g.losers.length} records back)`);
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
