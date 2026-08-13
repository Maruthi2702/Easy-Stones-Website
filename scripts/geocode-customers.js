/**
 * Give every customer already on file a point on the map.
 *
 *   node scripts/geocode-customers.js                  # dry run: what would be asked, and what it would cost
 *   node scripts/geocode-customers.js --apply          # do it
 *   node scripts/geocode-customers.js --apply --limit 20   # a first slice, to check the results before spending the rest
 *   node scripts/geocode-customers.js --apply --retry-failed  # ask again for addresses that found nothing
 *   node scripts/geocode-customers.js --report         # no calls: what we already hold, by precision
 *
 * Customers geocode themselves as they are saved (server.js). This exists for
 * the ones that were already here when coordinates were added, and for anything
 * an import creates in bulk — those are left 'pending' deliberately, so a 400-row
 * import does not sit waiting on 400 geocoding calls.
 *
 * Safe to stop and re-run: each customer is written as it is resolved, and a
 * customer that already holds a point for its current address is skipped, so a
 * second run costs nothing for the ones the first run did.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { geocodeAddress, addressKeyOf, hasGeocodingKey } from '../src/utils/geocode.js';
import { isRoutablePrecision } from '../src/utils/routePlan.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };

const APPLY = has('--apply');
const REPORT = has('--report');
const RETRY_FAILED = has('--retry-failed');
const LIMIT = Number(valueOf('--limit')) || Infinity;

// Google's own guidance is 50 requests/second; this is far below that. The
// point is not to please Google but to keep a runaway loop from spending real
// money faster than anyone can notice and stop it.
const PAUSE_MS = 120;
const COST_PER_1000 = 5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const nameOf = (c) => c.company || c.contactName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || String(c._id);

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGO_URI in .env — nothing to connect to.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const customers = mongoose.connection.db.collection('customers');

  if (REPORT) {
    const rows = await customers.find({}, { projection: { 'geocode.status': 1, 'geocode.precision': 1 } }).toArray();
    const tally = rows.reduce((acc, r) => {
      const key = r.geocode?.status === 'ok' ? `ok / ${r.geocode.precision || 'unknown'}` : (r.geocode?.status || 'pending');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log(`\n${rows.length} customers:`);
    Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
    const routable = rows.filter(r => r.geocode?.status === 'ok' && isRoutablePrecision(r.geocode.precision)).length;
    console.log(`\n${routable} are precise enough to route to.`);
    console.log("'approximate' is the geocoder falling back to the middle of the town — it maps, but do not drive to it.");
    await mongoose.disconnect();
    return;
  }

  // Anything without a usable point: never asked, asked but not answerable at
  // the time, or — with --retry-failed — an address that found nothing and may
  // since have been corrected.
  const wanted = RETRY_FAILED
    ? { $in: ['pending', 'failed', null] }
    : { $in: ['pending', null] };

  const all = await customers.find(
    { $or: [{ 'geocode.status': wanted }, { geocode: { $exists: false } }] },
    { projection: { company: 1, contactName: 1, firstName: 1, lastName: 1, address: 1, geocode: 1 } }
  ).toArray();

  // An address we already hold a point for needs no call even if some other
  // edit left the status behind — the key is the honest test.
  const todo = all
    .filter(c => addressKeyOf(c.address) && addressKeyOf(c.address) !== (c.geocode?.addressKey || ''))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  const noAddress = all.filter(c => !addressKeyOf(c.address));

  console.log(`\n${all.length} customers without a usable point.`);
  console.log(`  ${todo.length} have an address to look up${LIMIT === Infinity ? '' : ` (limited to ${LIMIT})`}`);
  console.log(`  ${noAddress.length} have no address at all — nothing to ask`);
  console.log(`  estimated cost: $${((todo.length / 1000) * COST_PER_1000).toFixed(2)} at $${COST_PER_1000}/1000\n`);

  if (!APPLY) {
    todo.slice(0, 15).forEach(c => console.log(`  would look up: ${nameOf(c)} — ${addressKeyOf(c.address)}`));
    if (todo.length > 15) console.log(`  ... and ${todo.length - 15} more`);
    console.log('\nDry run. Re-run with --apply to do it.');
    await mongoose.disconnect();
    return;
  }

  if (!hasGeocodingKey()) {
    console.error('No GOOGLE_GEOCODING_API_KEY (or GOOGLE_MAPS_API_KEY) in .env.');
    console.error('Every lookup would come back "pending" and nothing would be written. Add the key first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const tally = { rooftop: 0, range: 0, geometric: 0, approximate: 0, failed: 0, pending: 0 };

  for (const [i, customer] of todo.entries()) {
    const result = await geocodeAddress(customer.address);
    await customers.updateOne({ _id: customer._id }, { $set: result });

    const outcome = result.geocode.status === 'ok' ? result.geocode.precision : result.geocode.status;
    tally[outcome] = (tally[outcome] || 0) + 1;

    const mark = result.geocode.status === 'ok' ? '·' : '✗';
    console.log(`${mark} [${i + 1}/${todo.length}] ${nameOf(customer)} → ${outcome}${result.geocode.error ? ` (${result.geocode.error})` : ''}`);

    // A run that starts failing every call is usually a key or quota problem,
    // and continuing only turns one mistake into hundreds.
    if (tally.pending >= 10 && tally.rooftop + tally.range + tally.geometric + tally.approximate === 0) {
      console.error('\nTen lookups in a row could not be asked — stopping. Check the key and quota, then re-run.');
      break;
    }

    await sleep(PAUSE_MS);
  }

  console.log('\nDone:');
  Object.entries(tally).filter(([, n]) => n > 0).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  console.log(`\n  ${tally.rooftop + tally.range + tally.geometric} are precise enough to route to.`);
  if (tally.pending) console.log(`  ${tally.pending} could not be asked — re-run to retry them.`);
  if (tally.failed) console.log(`  ${tally.failed} found nothing. Fix the address, then --retry-failed.`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Geocoding run failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
