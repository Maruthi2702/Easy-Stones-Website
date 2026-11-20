/**
 * One-off (2026-11-19): create the Cabinet IQ branches from the old CRM's Atlanta export as
 * Dealer customers at Atlanta, when we don't already have them. Idempotent: a branch whose
 * name matches an existing customer (ignoring case and spaces) is skipped, and any other
 * customer with "cabinet iq" in its name is listed so a person can judge look-alikes.
 *
 *   node scripts/create-cabinet-iq-dealers.ts            # dry run
 *   node scripts/create-cabinet-iq-dealers.ts --apply    # create the missing ones
 *
 * Saves through `customerData.createCustomer` (the Add customer route's own save), no rep,
 * no map pin yet (run scripts/geocode-customers.ts afterwards, or edit the customer).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as customerData from '../src/db/customers/index.ts';
import { areaOn } from '../src/db/appDb.ts';
import { newId } from '../src/db/ids.ts';
import { newCustomerFields } from '../src/utils/customerRecord.ts';

dotenv.config();
const apply = process.argv.includes('--apply');

const BRANCHES = [
  { company: 'Cabinet IQ (Atlanta)', contactName: 'Yannick Boccovi', phone: '', email: '',
    address: { street: '433 Bishop St NW #F', city: 'Atlanta', state: 'GA', zipCode: '30318' },
    notes: 'Yannick Boccovi (Owner), Loretta Willis (Lead Designer).' },
  { company: 'Cabinet IQ (Alpharetta)', contactName: 'Sean', phone: '470-782-8547', email: 'Sean@cabinetiq.com',
    address: { street: '1425 Market Blvd', city: 'Roswell', state: 'GA', zipCode: '30076' }, notes: '' },
  { company: 'Cabinet IQ (Kennesaw)', contactName: 'Ben', phone: '470-619-5243', email: 'Ben@cabinetiq.com',
    address: { street: '2700 Town Center Dr NW', city: 'Kennesaw', state: 'GA', zipCode: '30144' }, notes: '' },
  { company: 'Cabinet IQ', contactName: '', phone: '706-613-4006', email: '',
    address: { street: '', city: '', state: '', zipCode: '' }, notes: 'Coming soon at Cabinet IQ. Other phone 704-613-0004.' }
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const main = async () => {
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);

  const all = (await customerData.dropdownCustomers()) as Record<string, unknown>[];
  const names = new Set(all.map((c) => norm(String(c.company ?? ''))));
  const alike = all.filter((c) => /cabinet\s*iq/i.test(String(c.company ?? '')));
  console.log(`${all.length} customers (customers on ${areaOn('customers')}). Already with "cabinet iq": ${alike.length}`);
  alike.forEach((c) => console.log(`  existing: ${c.company} (${c.city ?? ''})`));

  const missing = BRANCHES.filter((b) => !names.has(norm(b.company)));
  for (const b of BRANCHES) console.log(`  ${names.has(norm(b.company)) ? 'have it' : apply ? 'creating' : 'would create'}: ${b.company}`);

  if (apply) {
    for (const b of missing) {
      const { fields, error } = newCustomerFields({ ...b, customerType: 'Dealer', location: 'Atlanta', level: 'Level - 3' });
      if (error) throw new Error(error);
      const rep = await customerData.resolveSalesRep(undefined);
      await customerData.createCustomer({ id: newId(), fields: fields!, rep, geo: {}, createdBy: null });
    }
    console.log(`Created ${missing.length}.`);
  } else if (missing.length) console.log('Dry run: nothing written. Add --apply.');
  if (needsMongo) await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
