/**
 * One-off: create the office account of every location ("Office – Kent"), where
 * In-office admin day and Personal time off visits are logged
 * (src/utils/officeAccounts.ts). Idempotent: a location that already has one is skipped.
 *
 *   node scripts/create-office-accounts.ts            # dry run: lists what would be created
 *   node scripts/create-office-accounts.ts --apply    # create them
 *
 * Reads locations and customers through the data layers (MongoDB or Postgres by
 * DB_STAFF / DB_CUSTOMERS), and saves through `customerData.createCustomer`, the Add
 * customer route's own save. Each account has the location, the "Internal Office"
 * customer type, no rep, no phone and no address (so no map pin).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as customerData from '../src/db/customers/index.ts';
import * as staffData from '../src/db/staff/index.ts';
import { areaOn } from '../src/db/appDb.ts';
import { newId } from '../src/db/ids.ts';
import { newCustomerFields } from '../src/utils/customerRecord.ts';
import { OFFICE_CUSTOMER_TYPE, officeAccountName } from '../src/utils/officeAccounts.ts';

dotenv.config();
const apply = process.argv.includes('--apply');

const main = async () => {
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);

  const locations = (await staffData.locationNames()).filter((n) => n && n !== '*');
  const existing = new Set((await customerData.dropdownCustomers())
    .map((c: Record<string, unknown>) => String(c.company ?? '').trim().toLowerCase()));

  const missing = locations.filter((l) => !existing.has(officeAccountName(l).toLowerCase()));
  console.log(`${locations.length} locations; ${locations.length - missing.length} already have an office account.`);
  for (const l of missing) console.log(`  ${apply ? 'creating' : 'would create'}: ${officeAccountName(l)}`);

  if (apply) {
    for (const l of missing) {
      const { fields, error } = newCustomerFields({
        company: officeAccountName(l), customerType: OFFICE_CUSTOMER_TYPE, location: l, level: 'Level - 3'
      });
      if (error) throw new Error(error);
      const rep = await customerData.resolveSalesRep(undefined);
      await customerData.createCustomer({ id: newId(), fields: fields!, rep, geo: {}, createdBy: null });
    }
    console.log(`Created ${missing.length}.`);
  } else if (missing.length) {
    console.log('Dry run: nothing written. Add --apply to create them.');
  }
  if (needsMongo) await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
