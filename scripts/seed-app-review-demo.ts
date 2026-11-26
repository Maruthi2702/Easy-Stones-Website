/**
 * One-off (2026-11-26): the demo data for the App Store review login. Apple's reviewer signs in as `app.review`; so that
 * they (and the screenshots) see a working Route Planner map without any real customer's name, this makes
 *   - a location "Demo" (not a real branch; no staff work there),
 *   - 8 invented customers at well-known public places in Seattle (Space Needle, Pike Place Market…), no rep, no
 *     phone, no email, each with a map pin,
 *   - and points the `app.review` user at Demo only (home location and assigned locations).
 * Idempotent: whatever is already there is skipped.
 *
 *   node scripts/seed-app-review-demo.ts            # dry run: validates and lists what would be written
 *   node scripts/seed-app-review-demo.ts --apply    # write it
 *
 * Live Postgres is only reachable from Render, so run it in the Render shell. Reads and writes go through the same data
 * layers and rules the app's forms use (`parseable` location values, `newCustomerFields`, `createCustomer`,
 * `createLocation`). Map pins come from the same Google geocoder as Add customer (needs GOOGLE_GEOCODING_API_KEY; a
 * customer whose address can't be placed is still saved, without a pin, and reported).
 *
 * To undo: delete the 8 "Demo – …" customers in Customers and the Demo location in Users & Roles → Locations, and give
 * `app.review` its location back.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import type { Loose } from '../src/types/records.ts';
import * as customerData from '../src/db/customers/index.ts';
import * as staffData from '../src/db/staff/index.ts';
import { areaOn } from '../src/db/appDb.ts';
import { newId } from '../src/db/ids.ts';
import { newCustomerFields } from '../src/utils/customerRecord.ts';
import { emptyLocationValues, validateLocationValues, locationRecordFromValues } from '../src/utils/locationForm.ts';
import { geocodeAddress } from '../src/utils/geocode.ts';

dotenv.config();
const apply = process.argv.includes('--apply');

const LOGIN = 'app.review';
const LOCATION_NAME = 'Demo';

const LOCATION_VALUES = {
  ...emptyLocationValues(),
  fullName: 'Demo (App Store review)', name: LOCATION_NAME, shortCode: 'DEMO',
  street: '400 Broad St', city: 'Seattle', state: 'WA', zip: '98109'
};

const CUSTOMERS: { company: string; contactName: string; customerType: string; level: string; street: string; zipCode: string }[] = [
  { company: 'Demo – Granite & Quartz Studio', contactName: 'Alex Demo', customerType: 'Fabricator', level: 'Level - 3', street: '400 Broad St', zipCode: '98109' },
  { company: 'Demo – Kitchen & Bath Gallery', contactName: 'Sam Demo', customerType: 'Dealer', level: 'Level - 2', street: '85 Pike St', zipCode: '98101' },
  { company: 'Demo – Harbor Design Group', contactName: 'Jordan Demo', customerType: 'Designer', level: 'Level - 3', street: '800 Occidental Ave S', zipCode: '98134' },
  { company: 'Demo – Cascade Countertops', contactName: 'Taylor Demo', customerType: 'Fabricator', level: 'Level - 1', street: '1000 4th Ave', zipCode: '98104' },
  { company: 'Demo – Emerald City Stone', contactName: 'Casey Demo', customerType: 'Dealer', level: 'Level - 3', street: '325 5th Ave N', zipCode: '98109' },
  { company: 'Demo – Rainier Surfaces', contactName: 'Riley Demo', customerType: 'Fabricator', level: 'Level - 4', street: '303 S Jackson St', zipCode: '98104' },
  { company: 'Demo – Puget Interiors', contactName: 'Morgan Demo', customerType: 'Designer', level: 'Level - 2', street: '600 4th Ave', zipCode: '98104' },
  { company: 'Demo – Capitol Hill Tile & Stone', contactName: 'Jamie Demo', customerType: 'Dealer', level: 'Level - 3', street: '1400 E Galer St', zipCode: '98112' }
];

const main = async () => {
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);

  // 1. The Demo location.
  const locations = await staffData.locationBriefs();
  const haveLocation = Boolean(await staffData.locationByName(LOCATION_NAME));
  const problems = haveLocation ? {} : validateLocationValues(LOCATION_VALUES, { others: locations });
  if (Object.keys(problems).length) {
    console.error('The Demo location would be refused:', problems);
    process.exit(1);
  }
  console.log(haveLocation ? `Location "${LOCATION_NAME}": already there.` : `Location "${LOCATION_NAME}": ${apply ? 'creating' : 'would create'}.`);

  // 2. The customers.
  const existing = new Set((await customerData.dropdownCustomers()).map((c: Loose) => String(c.company ?? '').trim().toLowerCase()));
  const missing = CUSTOMERS.filter((c) => !existing.has(c.company.toLowerCase()));
  console.log(`Customers: ${CUSTOMERS.length - missing.length} already there, ${missing.length} ${apply ? 'to create' : 'would be created'}:`);
  for (const c of missing) {
    const { error } = newCustomerFields({ company: c.company, location: LOCATION_NAME });
    if (error) { console.error(`  ${c.company}: ${error}`); process.exit(1); }
    console.log(`  ${c.company} — ${c.customerType}, ${c.street}, Seattle WA ${c.zipCode}`);
  }

  // 3. The review login.
  const user = await staffData.findUser({ username: LOGIN });
  if (!user) {
    console.error(`No user "${LOGIN}" — create it in Users & Roles first (role with only harmless pages and Track location).`);
    process.exit(1);
  }
  const assigned = Array.isArray(user.assignedLocations) ? user.assignedLocations : [];
  const userDone = user.location === LOCATION_NAME && assigned.length === 1 && assigned[0] === LOCATION_NAME;
  console.log(`User ${LOGIN} (role ${user.role || 'none'}): home "${user.location ?? ''}", assigned [${assigned.join(', ')}] → ${userDone ? 'already Demo only' : `Demo only`}.`);

  if (!apply) {
    console.log('\nDry run — nothing written. Add --apply to write it.');
  } else {
    if (!haveLocation) {
      const record = locationRecordFromValues(LOCATION_VALUES);
      const placeIt = async (loc: Loose) => {
        const a = loc.primaryContact?.address || {};
        const patch = await geocodeAddress({ street: a.street, city: a.city, state: a.state, zipCode: a.zipCode });
        if (patch.geocode.status === 'ok') { loc.coordinates = patch.coordinates; loc.geocode = patch.geocode; }
      };
      const saved = await staffData.createLocation(record, 'seed-app-review-demo', placeIt);
      if (!saved.ok) throw new Error(`Could not create the Demo location (name or code already used).`);
      console.log('Created the Demo location.');
    }
    for (const c of missing) {
      const { fields } = newCustomerFields({
        company: c.company, contactName: c.contactName, customerType: c.customerType, level: c.level, location: LOCATION_NAME,
        address: { street: c.street, city: 'Seattle', state: 'WA', zipCode: c.zipCode }
      });
      const geo = await geocodeAddress(fields!.address);
      if (geo.geocode.status !== 'ok') console.log(`  no map pin for ${c.company}: ${geo.geocode.error}`);
      const rep = await customerData.resolveSalesRep(undefined);
      await customerData.createCustomer({ id: newId(), fields: fields!, rep, geo, createdBy: null });
    }
    console.log(`Created ${missing.length} customers.`);
    if (!userDone) {
      await staffData.updateUserById(user._id, { $set: { location: LOCATION_NAME, assignedLocations: [LOCATION_NAME] } });
      console.log(`Pointed ${LOGIN} at Demo only.`);
    }
  }
  if (needsMongo) await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
