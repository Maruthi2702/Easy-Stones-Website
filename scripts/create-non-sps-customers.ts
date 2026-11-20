/**
 * One-off (2026-11-19): create the rest of the old CRM's Atlanta accounts that are not in SPS
 * (the Cabinet IQ branches were done by create-cabinet-iq-dealers.ts) at Atlanta, unless we
 * already have them. A prospect starts as "New Lead". Nothing is created for an account that
 * matches an existing customer by name, name without LLC/Inc/punctuation, email, or street + ZIP;
 * a name that is only *similar* is reported and also skipped, so a person decides.
 *
 *   node scripts/create-non-sps-customers.ts            # dry run
 *   node scripts/create-non-sps-customers.ts --apply    # create the ones with no match
 *
 * Saves through `customerData.createCustomer` (the Add customer route's own save), no rep, no
 * map pin yet (run scripts/geocode-customers.ts afterwards). Type is the old CRM's category
 * (Design Firm -> Designer, K&B -> Dealer, blank -> Fabricator: `typeGuessed` ones are a guess).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import * as customerData from '../src/db/customers/index.ts';
import { areaOn } from '../src/db/appDb.ts';
import { newId } from '../src/db/ids.ts';
import { newCustomerFields } from '../src/utils/customerRecord.ts';

dotenv.config();
const apply = process.argv.includes('--apply');

const ACCOUNTS: { company: string; contactName: string; phone: string; email: string;
  address: { street: string; city: string; state: string; zipCode: string };
  customerType: string; prospect: boolean; typeGuessed: boolean; website: string; notes: string }[] = [
  {
    "company": "The Tile Shop",
    "contactName": "Teishana Jenkins",
    "phone": "678-279-2233",
    "email": "",
    "address": {
      "street": "162 Ernest W Barrett",
      "city": "",
      "state": "",
      "zipCode": ""
    },
    "customerType": "Dealer",
    "prospect": true,
    "typeGuessed": false,
    "website": "tile shop.com",
    "notes": ""
  },
  {
    "company": "Extreme Stone Company",
    "contactName": "",
    "phone": "256-476-5407",
    "email": "",
    "address": {
      "street": "308 Oakwood Ave",
      "city": "Huntsville",
      "state": "AL",
      "zipCode": "35811"
    },
    "customerType": "Designer",
    "prospect": false,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "Haley's Flooring",
    "contactName": "",
    "phone": "256-536-8086",
    "email": "",
    "address": {
      "street": "2806 Bob Wallace Ave SW",
      "city": "Huntsville",
      "state": "AL",
      "zipCode": "35805"
    },
    "customerType": "Designer",
    "prospect": false,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "Preissless Design",
    "contactName": "Mike Boyd",
    "phone": "678-806-5095",
    "email": "",
    "address": {
      "street": "934 Center St NE",
      "city": "Conyers",
      "state": "GA",
      "zipCode": "30012"
    },
    "customerType": "Designer",
    "prospect": true,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "The Designery Kitchens, Baths & Closets",
    "contactName": "Eric Kerley",
    "phone": "678-777-5556",
    "email": "eric.kerley@thedesignery.com",
    "address": {
      "street": "165 Outlet Center Dr SE",
      "city": "Calhoun",
      "state": "GA",
      "zipCode": "30701"
    },
    "customerType": "Fabricator",
    "prospect": true,
    "typeGuessed": false,
    "website": "thedesignery.com",
    "notes": ""
  },
  {
    "company": "Villa Countertop Stone Service",
    "contactName": "",
    "phone": "404-453-9544",
    "email": "",
    "address": {
      "street": "2916 Castle Dr",
      "city": "Lawrenceville",
      "state": "GA",
      "zipCode": "30044"
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "Jeffrey Beers",
    "contactName": "Debra King McGowan",
    "phone": "212-352-2020",
    "email": "",
    "address": {
      "street": "250 Greenwich St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10007"
    },
    "customerType": "Designer",
    "prospect": false,
    "typeGuessed": false,
    "website": "jeffreybeers.com",
    "notes": ""
  },
  {
    "company": "The Product Source",
    "contactName": "Sierra Porche",
    "phone": "770-592-3145",
    "email": "Sierrapirche@tpsgranite.com",
    "address": {
      "street": "302 Bell Park Dr",
      "city": "",
      "state": "",
      "zipCode": ""
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": false,
    "website": "www.hotelstone.com",
    "notes": ""
  },
  {
    "company": "Sterling Kitchens",
    "contactName": "JAMES HALE",
    "phone": "470-337-4642",
    "email": "sterlingcustomkitchens@gmail.com",
    "address": {
      "street": "",
      "city": "",
      "state": "",
      "zipCode": ""
    },
    "customerType": "Dealer",
    "prospect": false,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "University Granite, LLC",
    "contactName": "",
    "phone": "334-740-8462",
    "email": "",
    "address": {
      "street": "1057 Opelika Rd",
      "city": "Auburn",
      "state": "AL",
      "zipCode": ""
    },
    "customerType": "Designer",
    "prospect": false,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "Premier Countertops",
    "contactName": "Taylor Witt",
    "phone": "662-823-8824",
    "email": "taylor@premiertops.com",
    "address": {
      "street": "2341 Graham Dr",
      "city": "Tupelo",
      "state": "MS",
      "zipCode": "38801"
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": false,
    "website": "www.premiertops.com",
    "notes": "Alexis Busby (Inside Sales/Interior Designer)"
  },
  {
    "company": "The Stone Source Madison",
    "contactName": "",
    "phone": "",
    "email": "",
    "address": {
      "street": "1485 Highland Colony Pkwy",
      "city": "Madison",
      "state": "MS",
      "zipCode": "39110"
    },
    "customerType": "Fabricator",
    "prospect": true,
    "typeGuessed": true,
    "website": "",
    "notes": ""
  },
  {
    "company": "Brazilian stones",
    "contactName": "Guilerme And Victor",
    "phone": "678-430-6282",
    "email": "",
    "address": {
      "street": "",
      "city": "",
      "state": "",
      "zipCode": ""
    },
    "customerType": "Fabricator",
    "prospect": true,
    "typeGuessed": false,
    "website": "",
    "notes": ""
  },
  {
    "company": "Anatolia Granite, Marble, Glass & Metal",
    "contactName": "MARIO SOSA",
    "phone": "615-480-4950",
    "email": "mario.sosa@anatolia-us.com",
    "address": {
      "street": "445 Ward Mill Rd",
      "city": "Baxter",
      "state": "TN",
      "zipCode": "38544"
    },
    "customerType": "Fabricator",
    "prospect": true,
    "typeGuessed": true,
    "website": "anatoliagraniteandmarble.com",
    "notes": ""
  },
  {
    "company": "Robert F Henry Tile Company Inc",
    "contactName": "RONNY IRVIN",
    "phone": "334-269-2518",
    "email": "ap@henrytile.com",
    "address": {
      "street": "PO BOX 211209",
      "city": "Montgomery",
      "state": "AL",
      "zipCode": "36121"
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": true,
    "website": "",
    "notes": "April Riddle (Stone Shop Manager); Haley (Admin)"
  },
  {
    "company": "Standard Tile",
    "contactName": "Paul Hill",
    "phone": "256-546-7643",
    "email": "pr@standardtileal.com",
    "address": {
      "street": "60 Ewing Ave",
      "city": "Gadsden",
      "state": "AL",
      "zipCode": "35901"
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": true,
    "website": "",
    "notes": "Pam Collins (Office Manager Sales @ Ceramic Tile / Flooring Granite & Quartz Fabrication); Kim St. John (Showroom Manager Sales @ Standard Tile); P.R. Hill (Owner)"
  },
  {
    "company": "Waverly Stoneworks",
    "contactName": "",
    "phone": "334-864-8779",
    "email": "",
    "address": {
      "street": "6184 Hwy 431",
      "city": "Waverly",
      "state": "AL",
      "zipCode": "36879"
    },
    "customerType": "Fabricator",
    "prospect": false,
    "typeGuessed": true,
    "website": "",
    "notes": ""
  }
];

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(llc|inc|co|corp|company|ltd|the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const bigrams = (s: string) => { const t = s.replace(/ /g, ''); const m = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1); return m; };
const dice = (a: string, b: string) => {
  const x = bigrams(a), y = bigrams(b); let hit = 0, total = 0;
  x.forEach((n, k) => { hit += Math.min(n, y.get(k) ?? 0); total += n; }); y.forEach((n) => { total += n; });
  return total ? (2 * hit) / total : 0;
};
const place = (a?: Record<string, unknown>) => loose(`${a?.street ?? ''} ${String(a?.zipCode ?? '').slice(0, 5)}`);

const main = async () => {
  const needsMongo = areaOn('customers') !== 'postgres' || areaOn('staff') !== 'postgres';
  if (needsMongo) await mongoose.connect(process.env.MONGO_URI!);
  console.log(`Customers on ${areaOn('customers')}.`);
  if (apply && areaOn('customers') !== 'postgres') throw new Error('Customers are not on Postgres here: refusing to write.');

  const all = (await customerData.dropdownCustomers()) as Record<string, any>[];
  const create: typeof ACCOUNTS = [];
  for (const a of ACCOUNTS) {
    const l = loose(a.company);
    // A name match in a different state is another company with the same name: leave it to a person.
    const sameState = (c: Record<string, any>) => !a.address.state || !c.address?.state || String(c.address.state).toUpperCase() === a.address.state;
    const byName = all.find((c) => norm(String(c.company ?? '')) === norm(a.company) && sameState(c)) ? 'same name'
      : all.find((c) => loose(String(c.company ?? '')) === l && sameState(c)) ? 'same name (ignoring LLC/Inc)' : '';
    const hit = byName
      || (a.email && all.find((c) => String(c.email ?? '').toLowerCase() === a.email.toLowerCase()) ? 'same email'
      : a.address.street && all.find((c) => place(c.address) === place(a.address) && place(a.address).length > 6) ? 'same street + ZIP' : '');
    if (hit) { console.log(`  have it (${hit}): ${a.company}`); continue; }
    const near = all.map((c) => ({ c, s: dice(l, loose(String(c.company ?? ''))) })).filter((x) => x.s >= 0.75 && x.c.company !== undefined).sort((p, q) => q.s - p.s)[0];
    if (near) { console.log(`  SIMILAR, skipped: ${a.company}  ~  ${near.c.company} (${near.c.address?.city ?? ''} ${near.c.address?.state ?? ''}, ${Math.round(near.s * 100)}%)`); continue; }
    console.log(`  ${apply ? 'creating' : 'would create'}: ${a.company} [${a.customerType}${a.typeGuessed ? ', guessed' : ''}${a.prospect ? ', New Lead' : ''}]`);
    create.push(a);
  }

  if (apply) {
    for (const a of create) {
      const { fields, error } = newCustomerFields({
        company: a.company, contactName: a.contactName, phone: a.phone, email: a.email, address: a.address,
        notes: a.notes ? `Other contacts: ${a.notes}` : '', customerType: a.customerType, location: 'Atlanta', level: 'Level - 3',
        ...(a.prospect ? { status: 'New Lead' } : {})
      });
      if (error) throw new Error(`${a.company}: ${error}`);
      const rep = await customerData.resolveSalesRep(undefined);
      await customerData.createCustomer({ id: newId(), fields: fields!, rep, geo: {}, createdBy: null });
    }
    console.log(`Created ${create.length}.`);
  } else console.log(`Dry run: ${create.length} would be created. Add --apply.`);
  if (needsMongo) await mongoose.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
