/**
 * One-off (2026-11-19), follow-up to create-non-sps-customers.ts:
 *  1. add the two Blue Sky contacts the old CRM has and SPS doesn't to the existing
 *     "Blue Sky Granite & Marble (TN)" customer (its address is the Kennesaw GA one);
 *  2. create Blue Sky Granite & Marble (Chattanooga) (Ooltewah TN) and Premier Countertops
 *     (Tupelo MS), which are different companies from the existing ones, at Atlanta.
 * Idempotent: a contact whose email is already on the customer, or a customer already there
 * with the same name and state, is skipped.
 *
 *   node scripts/create-non-sps-followup.ts            # dry run
 *   node scripts/create-non-sps-followup.ts --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as customerData from '../src/db/customers/index.ts';
import { areaOn } from '../src/db/appDb.ts';
import { newId } from '../src/db/ids.ts';
import { newCustomerFields } from '../src/utils/customerRecord.ts';

dotenv.config();
const apply = process.argv.includes('--apply');
const now = () => new Date().toISOString().replace('Z', '');

type C = { name: string; phone: string; email: string; role: string; notes: string };
const BLUE_SKY_EXTRA: C[] = [
  { name: 'Mauricio Arbelaez', phone: '678-699-6360', email: 'mauricio@bluesky-granite.com', role: '', notes: 'Work: 770-970-0950' },
  { name: 'Luisana Coronado', phone: '470-232-8894', email: 'luisana@bluesky-granite.com', role: '', notes: 'Work: 770-970-0950' }
];
const NEW_CUSTOMERS = [
  { company: 'Blue Sky Granite & Marble (Chattanooga)', contactName: 'Scott Steventon', phone: '423-599-8799', email: 'scott@blueskychattanooga.com',
    address: { street: '8627 Hilltop Dr', city: 'Ooltewah', state: 'TN', zipCode: '37363' }, customerType: 'Fabricator', notes: 'Scott Steventon work: 423-910-0238',
    extra: [] as C[] },
  { company: 'Premier Countertops', contactName: 'Taylor Witt', phone: '662-823-8824', email: 'taylor@premiertops.com',
    address: { street: '2341 Graham Dr', city: 'Tupelo', state: 'MS', zipCode: '38801' }, customerType: 'Fabricator', notes: 'Taylor Witt mobile: 662-255-3421',
    extra: [{ name: 'Alexis Busby', phone: '662-823-8824', email: 'alexis@premiertops.com', role: 'Inside Sales/Interior Designer', notes: '' }] }
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const main = async () => {
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);
  console.log(`Customers on ${areaOn('customers')}.`);
  if (apply && areaOn('customers') !== 'postgres') throw new Error('Customers are not on Postgres here: refusing to write.');
  const all = (await customerData.dropdownCustomers()) as Record<string, any>[];

  // 1. contacts on the existing Blue Sky
  const blue = all.filter((c) => norm(String(c.company)) === norm('Blue Sky Granite & Marble (TN)'));
  if (blue.length !== 1) console.log(`  Blue Sky (TN): found ${blue.length} customers by that name, no contacts added.`);
  else {
    const rec: any = await customerData.customerById(String(blue[0]._id));
    const have = new Set((rec?.contacts ?? []).map((k: any) => String(k.email ?? '').toLowerCase()));
    for (const k of BLUE_SKY_EXTRA) {
      if (have.has(k.email)) { console.log(`  contact already there: ${k.name}`); continue; }
      console.log(`  ${apply ? 'adding' : 'would add'} contact to Blue Sky (TN): ${k.name}`);
      if (apply) await customerData.addContact(String(blue[0]._id), newId(), { ...k, createdAt: now() });
    }
  }

  // 2. the two new customers
  for (const n of NEW_CUSTOMERS) {
    const dup = all.find((c) => norm(String(c.company)) === norm(n.company) && String(c.address?.state ?? '').toUpperCase() === n.address.state);
    if (dup) { console.log(`  have it: ${n.company} (${n.address.state})`); continue; }
    console.log(`  ${apply ? 'creating' : 'would create'}: ${n.company} (${n.address.city} ${n.address.state})`);
    if (!apply) continue;
    const { extra, ...body } = n;
    const { fields, error } = newCustomerFields({ ...body, location: 'Atlanta', level: 'Level - 3' });
    if (error) throw new Error(`${n.company}: ${error}`);
    const id = newId();
    const rep = await customerData.resolveSalesRep(undefined);
    await customerData.createCustomer({ id, fields: fields!, rep, geo: {}, createdBy: null });
    for (const k of extra) await customerData.addContact(id, newId(), { ...k, createdAt: now() });
  }
  console.log(apply ? 'Done.' : 'Dry run: nothing written. Add --apply.');
  if (needsMongo) await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
