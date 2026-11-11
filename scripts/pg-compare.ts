/**
 * Does the Postgres data layer answer what MongoDB answers, on real data?
 *
 *   node --env-file=.env scripts/pg-compare.ts            (a fresh copy into PGlite in memory)
 *   DATABASE_URL=pglite:/tmp/pg node … scripts/pg-compare.ts --no-copy   (an earlier copy)
 *
 * Reads MongoDB only (MONGO_URI; never writes it), copies it into a Postgres you can
 * throw away (PGlite in memory unless DATABASE_URL says otherwise; never RDS — the copy
 * empties what it fills), then asks each read in src/db/<area>/ of both and prints the
 * differences, the way the screens would see them (src/db/customers/parity.ts).
 * Exit 0 = the same everywhere.
 */
import mongoose from 'mongoose';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import * as customers from '../src/db/customers/index.ts';
import { normalize, diffEntries, describeDifference, knownWhy, profileParityContext } from '../src/db/customers/parity.ts';
import type { CustomerList, CustomerListQuery } from '../src/db/customers/types.ts';
import type { Loose } from '../src/types/records.ts';
import { addDays } from '../src/utils/customerList.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
const pgUrl = process.env.DATABASE_URL?.startsWith('pglite:') ? process.env.DATABASE_URL : 'pglite:memory';
const noCopy = process.argv.includes('--no-copy');

const pg = await openDb(pgUrl);
await migrateDb(pg.db, pgUrl);
let copiedCustomers: Loose[] | undefined;
if (!noCopy) {
  console.log('Reading MongoDB and copying into', pgUrl, '…');
  const source = await readMongo(mongoUri, 'pg-compare');
  copiedCustomers = source.customers;
  const report = await copyFromMongo(pg.db, source, { write: true });
  console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
}
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare', autoIndex: false, autoCreate: false });

type Rec = { _id: string; createdAt?: string };
type Page = { total: number; customers: Rec[] };
const sortById = (list: Rec[]) => [...list].sort((a, b) => a._id.localeCompare(b._id));
const pageById = (v: unknown) => ({ ...(v as Page), customers: sortById((v as Page).customers) });
const ALL = 100_000;

/**
 * Each read, with what it's asked. `prepare` evens out the order where equal sort keys
 * may tie differently, or where a known difference is set aside (README "Known differences").
 */
const reads: { name: string; read: () => Promise<unknown>; prepare?: (v: unknown, mongo: unknown) => unknown }[] = [
  { name: 'customers: dropdown, every field by id', read: () => customers.dropdownCustomers(), prepare: v => sortById(v as Rec[]) },
  { name: 'customers: cities', read: () => customers.customerCities() },
  { name: 'customers: every customer, every field by id', read: () => customers.customerPage({ page: 1, limit: ALL, search: '' }), prepare: pageById },
  {
    // MongoDB lists a customer saved without createdAt last; Postgres has its real date (from its id).
    // Compared by the dates in order, since customers imported in the same millisecond tie.
    name: 'customers: newest-first order (customers MongoDB holds no createdAt for set aside)',
    read: () => customers.customerPage({ page: 1, limit: ALL, search: '' }),
    prepare: (v, mongo) => {
      const undated = new Set((mongo as Page).customers.filter(c => !c.createdAt).map(c => c._id));
      return (v as Page).customers.filter(c => !undated.has(c._id)).map(c => c.createdAt);
    }
  },
  { name: 'customers: search "stone"', read: () => customers.customerPage({ page: 1, limit: ALL, search: 'stone' }), prepare: pageById },
  { name: 'customers: search "@gmail"', read: () => customers.customerPage({ page: 1, limit: ALL, search: '@gmail' }), prepare: pageById },
  { name: 'customers: search "N/A"', read: () => customers.customerPage({ page: 1, limit: ALL, search: 'N/A' }), prepare: pageById }
];

// The Customers page: compare every field and membership for each filter;
// check the actual sort keys separately so ties cannot hide an ordering bug.
const owner = await mongoose.connection.db!.collection('customers').findOne(
  { salesRep: { $type: 'objectId' } }, { projection: { salesRep: 1 } });
const listBase: CustomerListQuery = {
  page: 1, limit: -1, search: '', mayProfile: true, userId: owner?.salesRep?.toString(),
  today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()),
  sortBy: 'company', sortOrder: 1
};
const listById = (v: unknown) => ({ ...(v as CustomerList), partners: sortById(((v as CustomerList).partners ?? []) as Rec[]) });
const listCases: [string, Partial<CustomerListQuery>][] = [
  ['all rows', {}], ['basic-card rows', { mayProfile: false }],
  ['page 1', { limit: 50 }], ['page 2', { page: 2, limit: 50 }],
  ['empty result', { search: 'no-match-customer-list-987654321' }],
  ...['stone', '@gmail', '206', 'Seattle', '%', '_', '\\'].map(search => [`search ${JSON.stringify(search)}`, { search }] as [string, Partial<CustomerListQuery>]),
  ...['mine', 'followups', 'onboarding', 'noModa', 'unassigned', 'incomplete'].map(view => [`view ${view}`, { view }] as [string, Partial<CustomerListQuery>]),
  ...['A', 'S', '#'].map(letter => [`letter ${letter}`, { letter }] as [string, Partial<CustomerListQuery>]),
  ...['display', 'noDisplay', 'binders', 'noBinders', 'display,binders'].map(moda => [`Moda ${moda}`, { moda }] as [string, Partial<CustomerListQuery>]),
  ['multiple levels', { level: 'Level - 1,Level - 3' }], ['multiple statuses', { status: 'New Lead,Trying to Onboard' }],
  ['Fabricators', { type: 'fabricator' }], ['partners', { typeExclude: 'Fabricator' }],
  ['multiple types', { type: 'Designer,Builder' }], ['exclude types', { typeExclude: 'Designer,Builder' }],
  ['city regex', { city: '^Kent$' }], ['multiple cities', { city: 'Kent,Dallas' }],
  ['multiple branches', { location: 'Seattle,Dallas' }], ['unassigned reps', { salesRep: 'unassigned' }],
  ['owner and unassigned', { salesRep: `${listBase.userId || ''},unassigned` }],
  ['combined filters', { type: 'fabricator', location: 'Seattle', moda: 'noDisplay', level: 'Level - 3' }]
];
for (const [name, query] of listCases) reads.push({
  name: `customer list: ${name}`, read: () => customers.customerList({ ...listBase, ...query }), prepare: listById
});
// Customers MongoDB holds with no rep name at all (missing sorts before '' there).
const noRepName = new Set((await mongoose.connection.db!.collection('customers')
  .find({ salesRepName: { $exists: false } }, { projection: { _id: 1 } }).toArray()).map(c => String(c._id)));
// The exact order, row by row (the id is the last sort key on both databases), setting
// aside only the customers a documented difference places elsewhere (README Known differences).
for (const sortBy of ['company', 'level', 'city', 'salesRep', 'location', 'createdAt']) {
  for (const sortOrder of [1, -1] as const) reads.push({
    name: `customer list: ${sortBy} ${sortOrder === 1 ? 'ascending' : 'descending'}, exact order`,
    read: () => customers.customerList({ ...listBase, sortBy, sortOrder }),
    prepare: (v, mongo) => {
      const omitted = new Set(((mongo as CustomerList).partners ?? []).filter(c =>
        sortBy === 'createdAt' ? !c.createdAt
          : sortBy === 'salesRep' && (c.salesRepName === 'krish' || noRepName.has(c._id))).map(c => c._id));
      return ((v as CustomerList).partners ?? []).filter(c => !omitted.has(c._id)).map(c => c._id);
    }
  });
}

// Badge counts are compared strictly, without normalizing numeric differences.
// A dangling rep or a skipped branch in the source must surface before cutover.
for (const tab of [undefined, 'fabricators', 'partners', 'Partners', 'unknown']) {
  for (const [label, userId] of [['owner', listBase.userId], ['no owner', undefined], ['invalid owner', 'invalid']] as const) {
    reads.push({
      name: `saved-view counts: ${tab ?? 'default tab'}, ${label}`,
      read: () => customers.customerViewCounts({ tab, userId, today: listBase.today })
    });
  }
}
for (const tab of ['fabricators', 'partners']) {
  reads.push({
    name: `saved-view counts: ${tab}, uppercase owner`,
    read: () => customers.customerViewCounts({ tab, userId: listBase.userId?.toUpperCase(), today: listBase.today })
  });
  for (const shift of [-7, 1]) reads.push({
    name: `saved-view counts: ${tab}, day offset ${shift}`,
    read: () => customers.customerViewCounts({ tab, userId: listBase.userId, today: addDays(listBase.today, shift) })
  });
}

// Check every customer with nested history, contacts or links, plus a plain profile.
// Small batches keep the source reads and local SQL bounded without serial network round trips
// (PG_COMPARE_CONCURRENCY, default 16, for a big database).
const profileSource = await mongoose.connection.db!.collection('customers').find({ $or: [
  { 'visits.0': { $exists: true } }, { 'resources.0': { $exists: true } },
  { 'contacts.0': { $exists: true } }, { 'associatedCustomers.0': { $exists: true } }
] }, { projection: { _id: 1, visits: { _id: 1 }, resources: { _id: 1 } } }).sort({ _id: 1 }).toArray();
const plainProfile = await mongoose.connection.db!.collection('customers').findOne({
  'visits.0': { $exists: false }, 'resources.0': { $exists: false },
  'contacts.0': { $exists: false }, 'associatedCustomers.0': { $exists: false }
}, { projection: { _id: 1 } });
const profileIds = [...new Set([...profileSource.map(c => String(c._id)), ...(plainProfile ? [String(plainProfile._id)] : [])])];
// Only the fields the parity facts read, so a big database is not held whole in memory.
const profileFacts = profileParityContext(copiedCustomers ?? await mongoose.connection.db!.collection('customers').find({}, { projection: {
  location: 1, company: 1, contactName: 1, 'contacts._id': 1, 'visits._id': 1, 'visits.createdBy': 1, 'visits.reactions._id': 1, 'resources._id': 1
} }).toArray());
const profileReads: typeof reads = [];
async function batched<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const size = Math.max(1, Number(process.env.PG_COMPARE_CONCURRENCY) || 16);
  for (let start = 0; start < items.length; start += size) out.push(...await Promise.all(items.slice(start, start + size).map(read)));
  return out;
}
for (const [label, people] of [['all', '*'], ['own', new Set(listBase.userId ? [listBase.userId] : [])], ['empty', new Set<string>()]] as const) {
  profileReads.push({ name: `customer profiles: ${label}, all nested fields and linked last-visits`,
    read: () => batched(profileIds, id => customers.customerProfile(id, { mayProfile: true, people })) });
}
profileReads.push({ name: 'customer profiles: basic cards', read: () => batched(profileIds, id => customers.customerProfile(id, { mayProfile: false, people: '*' })) });
for (const kind of ['visits', 'resources'] as const) {
  const entries = profileSource.flatMap(c => (c[kind] ?? []).map((entry: { _id: unknown }) => ({ customerId: String(c._id), entryId: String(entry._id) })));
  for (const [label, people] of [['all', '*'], ['own', new Set(listBase.userId ? [listBase.userId] : [])]] as const) {
    profileReads.push({ name: `customer ${kind} details: ${label}, every saved entry`,
      read: () => batched(entries, entry => customers.customerHistoryEntry(entry.customerId, kind, entry.entryId, people)) });
  }
}
reads.unshift(...profileReads);

let failed = 0;
const known = new Map<string, { count: number; example: string }>();
for (const { name, read, prepare } of reads) {
  process.env.DB_CUSTOMERS = 'mongo';
  const rawM = normalize(await read());
  process.env.DB_CUSTOMERS = 'postgres';
  const rawP = normalize(await read());
  const m = prepare ? prepare(rawM, rawM) : rawM;
  const p = prepare ? prepare(rawP, rawM) : rawP;
  const all = diffEntries(m, p, 1_000_000);
  const unknown = all.filter(d => {
    const why = knownWhy(d, { postgres: p, profiles: profileFacts });
    if (!why) return true;
    const k = known.get(why) ?? { count: 0, example: `${name} → ${describeDifference(d)}` };
    k.count++;
    known.set(why, k);
    return false;
  });
  const list = Array.isArray(p) ? p : (p as Page)?.customers ?? (p as CustomerList)?.partners;
  const size = Array.isArray(list) ? `(${list.length} rows)` : '';
  const knownNote = all.length > unknown.length ? `, ${all.length - unknown.length} known differences` : '';
  if (unknown.length) {
    failed++;
    console.log(`✗ ${name} ${size}${knownNote}`);
    for (const d of unknown.slice(0, Number(process.env.DIFF_LIMIT || 15))) console.log(`    ${describeDifference(d)}`);
  } else {
    console.log(`✓ ${name} ${size}${knownNote}`);
  }
}

if (known.size) {
  console.log('\nKnown differences (src/db/README.md):');
  for (const [why, { count, example }] of known) console.log(`  ${count} × ${why}\n      e.g. ${example}`);
}

await mongoose.disconnect();
await pg.close();
console.log(failed ? `\n${failed} of ${reads.length} reads differ.` : `\nAll ${reads.length} reads answer the same.`);
process.exit(failed ? 1 : 0);
