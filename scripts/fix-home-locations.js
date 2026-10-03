/**
 * One-off: give every user a valid home location (User.location), now that
 * every location filter opens on it (src/utils/locationFilter.js).
 *
 *   node scripts/fix-home-locations.js           # dry run, lists who needs fixing
 *   node scripts/fix-home-locations.js --apply   # back up, then write
 *
 * Until now the Users & Roles form set the home location silently to whichever
 * assigned location was ticked first — '*' for an all-locations user — and the
 * /admin page let it be typed freely, so some are blank, '*', or a branch the
 * person is no longer assigned. Each of those becomes their first assigned
 * branch. All-locations users get none (filters open on All, as before) —
 * the list printed here is who an admin may want to give one by hand.
 * Each update only applies if the user still has the value read here, and the
 * originals are saved to scripts/merge-backups/ first.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { homeLocationOf, fallbackHomeLocation } from '../src/utils/locationFilter.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('users');
  const users = await col.find({}, { projection: { username: 1, displayName: 1, role: 1, location: 1, assignedLocations: 1 } }).toArray();

  const fixes = [];
  const allLocationsWithoutHome = [];
  for (const u of users) {
    const assigned = Array.isArray(u.assignedLocations) ? u.assignedLocations : [];
    if (homeLocationOf(u)) continue;
    const to = assigned.includes('*') ? '' : fallbackHomeLocation(assigned);
    if (assigned.includes('*') && !to) allLocationsWithoutHome.push(u);
    if ((u.location ?? '') !== to) fixes.push({ u, to });
  }

  const name = (u) => `${u.displayName || u.username} (${u.username}, ${u.role || 'no role'})`;
  console.log(`${users.length} users, ${fixes.length} to fix:\n`);
  for (const { u, to } of fixes) {
    console.log(`  ${name(u)}  assigned [${(u.assignedLocations || []).join(', ')}]  home "${u.location ?? ''}" → "${to}"`);
  }
  if (allLocationsWithoutHome.length) {
    console.log('\nAll-locations users with no home location (their filters open on All locations;');
    console.log('set one in Users & Roles if they should open on a branch instead):\n');
    for (const u of allLocationsWithoutHome) console.log(`  ${name(u)}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else if (fixes.length) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `home-locations-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(fixes.map(f => f.u), null, 2));
    console.log(`\nBacked up ${fixes.length} users to ${file}`);
    for (const { u, to } of fixes) {
      const r = await col.updateOne(
        { _id: u._id, location: u.location === undefined ? { $exists: false } : u.location },
        { $set: { location: to } }
      );
      console.log(`  ${u.username}  ${r.modifiedCount ? 'updated' : 'changed since — skipped'}`);
    }
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
