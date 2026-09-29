/**
 * Give every transfer an expected arrival date it can be seen by.
 *
 *   node scripts/backfill-transfer-arrivals.js           # dry run, prints what would change
 *   node scripts/backfill-transfer-arrivals.js --apply   # write it
 *
 * The destination branch only ever sees a transfer through expectedArrivalDate
 * (its board and its Daily Work Report's inbound line), so transfers saved
 * while the field was optional are invisible to the branch receiving them.
 * This fills a blank one with the ship date — the same default saves now apply
 * (transferArrivalFor in src/utils/deliveryTypes.js). Only expectedArrivalDate
 * is written; transfers with no ship date are left alone.
 *
 * Arrivals that are set but earlier than the ship date are only listed, not
 * changed: someone typed those, so which of the two dates is wrong is a call
 * for a person, not this script. (Editing one now asks for a valid arrival
 * before the modal will save it, and POST moves it up to the ship date.)
 *
 * Submitted Daily Work Reports are not re-derived, so this changes what future
 * and draft reports count, never a report that has already been signed off.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Delivery from '../src/models/Delivery.js';
import { transferArrivalFor } from '../src/utils/deliveryTypes.js';

dotenv.config();

const apply = process.argv.includes('--apply');

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
    console.log(`\n${backwards.length} arrive before they ship — listed only, not changed:\n`);
    for (const t of backwards) {
      console.log(`  ${route(t)}  ship ${t.date}  arrival ${t.expectedArrivalDate}  [${t.status}]`);
    }
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else if (changes.length) {
    const result = await Delivery.bulkWrite(changes.map(({ t, next }) => ({
      updateOne: { filter: { id: t.id }, update: { $set: { expectedArrivalDate: next } } }
    })));
    console.log(`\nUpdated ${result.modifiedCount} transfers.`);
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
