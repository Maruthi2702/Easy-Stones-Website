/**
 * Give every transfer an expected arrival date it can be seen by.
 *
 *   node scripts/backfill-transfer-arrivals.js                       # dry run, prints what would change
 *   node scripts/backfill-transfer-arrivals.js --apply               # back up, then write
 *   node scripts/backfill-transfer-arrivals.js --apply --fix-early   # …and move early arrivals up too
 *
 * The destination branch only ever sees a transfer through expectedArrivalDate
 * (its board and its Daily Work Report's inbound line), so transfers saved
 * while the field was optional are invisible to the branch receiving them.
 * This fills a blank one with the ship date — the same default saves now apply
 * (transferArrivalFor in src/utils/deliveryTypes.js). Only expectedArrivalDate
 * is written; transfers with no ship date are left alone.
 *
 * Arrivals that are set but earlier than the ship date are only listed, not
 * changed, unless --fix-early is given: someone typed those, so which of the
 * two dates is wrong is a call for a person. On 2026-10-05 the owner decided:
 * move them up to the ship date (--fix-early), the same rule saves apply now.
 *
 * Each write only applies if the ticket still has the arrival it had when
 * listed, and the originals are saved to scripts/merge-backups/ first.
 *
 * Submitted Daily Work Reports are not re-derived, so this changes what future
 * and draft reports count, never a report that has already been signed off.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Delivery from '../src/models/Delivery.js';
import { transferArrivalFor } from '../src/utils/deliveryTypes.js';

dotenv.config();

const apply = process.argv.includes('--apply');
const fixEarly = process.argv.includes('--fix-early');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const transfers = await Delivery.find(
    { deliveryType: 'transfer' },
    { id: 1, date: 1, expectedArrivalDate: 1, location: 1, transferDestination: 1, status: 1 }
  ).lean();

  const route = (t) => `${t.id}  ${t.location || '(none)'} → ${t.transferDestination || '(none)'}`;

  const changes = transfers
    .filter((t) => t.date && !t.expectedArrivalDate)
    .map((t) => ({ t, next: transferArrivalFor(t) }));

  console.log(`${transfers.length} transfers, ${changes.length} with no arrival date.\n`);
  for (const { t, next } of changes) {
    console.log(`  ${route(t)}  ship ${t.date}  arrival (blank) → ${next}  [${t.status}]`);
  }

  const backwards = transfers.filter((t) => t.date && t.expectedArrivalDate && t.expectedArrivalDate < t.date);
  if (backwards.length) {
    console.log(`\n${backwards.length} arrive before they ship — ${fixEarly ? 'arrival moves up to the ship date' : 'listed only, not changed (add --fix-early to move them up to the ship date)'}:\n`);
    for (const t of backwards) {
      console.log(`  ${route(t)}  ship ${t.date}  arrival ${t.expectedArrivalDate}  [${t.status}]`);
    }
  }

  const early = fixEarly ? backwards.map((t) => ({ t, next: t.date })) : [];
  const writes = [...changes, ...early];

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else if (writes.length) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `transfer-arrivals-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(writes.map(({ t }) => t), null, 2));
    console.log(`\nBacked up ${writes.length} records to ${file}`);
    // Only if the arrival is still what was listed — a ticket edited since is left alone.
    const result = await Delivery.bulkWrite(writes.map(({ t, next }) => ({
      updateOne: {
        filter: { id: t.id, expectedArrivalDate: t.expectedArrivalDate ?? { $in: ['', null] } },
        update: { $set: { expectedArrivalDate: next } }
      }
    })));
    console.log(`Updated ${result.modifiedCount} of ${writes.length} transfers.`);
  }
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
