/**
 * One-off: give a branch to the old tickets saved before deliveries recorded
 * one (Jul 27 – Aug 10, 2026).
 *
 *   node scripts/backfill-ticket-branches.js           # dry run, prints what would change
 *   node scripts/backfill-ticket-branches.js --apply   # back up, then write
 *
 * Since 2026-10-05 the Daily Report counts a ticket only on its own branch's
 * report (deriveFromSystem in src/routes/dailyReports.js). A ticket with no
 * branch used to count on every branch's; now it counts on none, so these
 * would drop off Seattle's figures if one of those days were reopened.
 *
 * The branch comes from the driver who carried the ticket — every one of these
 * was on a Seattle driver (Sergio, Jonathan), and the driver's branch in Users
 * & Roles is the evidence. A ticket on an all-branch column (the 3rd-party
 * truck) or with no driver is left alone: there's nothing to tell its branch
 * from. The one such ticket today, the 2026-08-10 transfer to Spokane
 * (#18299), is fixed by scripts/fix-transfer-origins.js.
 *
 * Each update only applies if the ticket still has no branch, and the
 * originals are saved to scripts/merge-backups/ first.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const apply = process.argv.includes('--apply');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');
const NO_BRANCH = { $or: [{ location: '' }, { location: null }, { location: { $exists: false } }] };

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const col = db.collection('deliveries');

  const tickets = await col.find(NO_BRANCH).toArray();
  const users = await db.collection('users').find({}, { projection: { username: 1, location: 1, assignedLocations: 1 } }).toArray();

  // A driver column is `drv_<username>`; their branch is their one assigned
  // location (or home location). Anyone on '*' or several branches can't say.
  const branchOfDriver = (truckId) => {
    if (!String(truckId || '').startsWith('drv_')) return null;
    const user = users.find((u) => `drv_${u.username}` === truckId);
    if (!user) return null;
    const assigned = (user.assignedLocations || []).filter((l) => l && l !== '*');
    if ((user.assignedLocations || []).includes('*')) return null;
    if (assigned.length === 1) return assigned[0];
    if (!assigned.length && user.location && user.location !== '*') return user.location;
    return null;
  };

  const plan = tickets.map((t) => ({ t, to: branchOfDriver(t.truckId) }));
  const fixable = plan.filter((p) => p.to);
  const left = plan.filter((p) => !p.to);

  const byBranch = fixable.reduce((acc, p) => ({ ...acc, [p.to]: (acc[p.to] || 0) + 1 }), {});
  console.log(`${tickets.length} tickets with no branch.`);
  console.log(`  Would set the branch on ${fixable.length}: ${Object.entries(byBranch).map(([b, n]) => `${b} ${n}`).join(', ') || 'none'}`);
  const dates = [...new Set(fixable.map((p) => p.t.date))].sort();
  if (dates.length) console.log(`  Dates: ${dates[0]} … ${dates.at(-1)}`);
  for (const p of left) {
    console.log(`  Left alone (no driver branch to go by): ${p.t.id}  ${p.t.date}  ${p.t.deliveryType || 'jobsite'}  truck ${p.t.truckId || '(none)'}${p.t.transferDestination ? ` → ${p.t.transferDestination}` : ''}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else if (fixable.length) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `ticket-branches-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(fixable.map((p) => p.t), null, 2));
    console.log(`\nBacked up ${fixable.length} records to ${file}`);
    let changed = 0;
    for (const p of fixable) {
      const r = await col.updateOne({ _id: p.t._id, ...NO_BRANCH }, { $set: { location: p.to } });
      changed += r.modifiedCount;
    }
    console.log(`Updated ${changed} of ${fixable.length}.`);
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
