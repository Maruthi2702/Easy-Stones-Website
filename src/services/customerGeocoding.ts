import type { Loose } from '../types/records.ts';
import mongoose from 'mongoose';
import Customer from '../models/Customer.ts';
import { geocodeAddress, addressKeyOf, hasGeocodingKey } from '../utils/geocode.ts';

/**
 * Map pins for customers that a bulk write created or moved (Excel import, SPS
 * import). A single Add / Edit customer geocodes inline in server.ts; a bulk
 * write can't — 400 rows would sit waiting on 400 Google calls — so it saves
 * them 'pending' and hands their ids here once it has finished. The lookups run
 * in the background, one at a time, never block or fail the import, and only
 * touch customers whose address isn't already the one their point came from.
 * What this doesn't cover (customers already pending from before) is
 * scripts/geocode-customers.ts.
 */
const PAUSE_MS = 120; // same pace as the backfill script: far under Google's limit, slow enough to stop a runaway
const GIVE_UP_AFTER = 10; // lookups in a row that couldn't be asked (key/quota): stop rather than repeat the mistake

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let afterBatch = () => {};
/** server.ts sets what happens once pins have been written (clear the map's cache, tell open screens). */
export const onCustomersGeocoded = (fn: () => void) => { afterBatch = fn; };

let queue = Promise.resolve();

async function geocodeIds(ids: string[]) {
  if (!hasGeocodingKey()) return;
  const objectIds = [...new Set(ids.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return;

  const rows = await Customer.collection.find(
    { _id: { $in: objectIds }, 'geocode.status': { $in: ['pending', null] } },
    { projection: { address: 1, geocode: 1 } }
  ).toArray();
  const todo = rows.filter((c) => addressKeyOf(c.address) && addressKeyOf(c.address) !== (c.geocode?.addressKey || ''));

  let wrote = 0;
  let unasked = 0;
  for (const customer of todo) {
    const result = await geocodeAddress(customer.address);
    await Customer.collection.updateOne({ _id: customer._id }, { $set: result });
    if (result.geocode.status === 'pending') {
      if (++unasked >= GIVE_UP_AFTER && !wrote) break;
    } else {
      unasked = 0;
      wrote++;
    }
    await sleep(PAUSE_MS);
  }
  if (wrote) afterBatch();
}

/** Queue pins for these customers. Returns at once; errors are logged, never thrown. */
export function geocodeCustomersInBackground(ids: string[] = []) {
  if (!ids.length) return;
  queue = queue
    .then(() => geocodeIds(ids))
    .catch((err) => console.error('Background geocoding error:', err));
}
