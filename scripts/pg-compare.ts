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
import { normalize, diffEntries, describeDifference, knownWhy } from '../src/db/customers/parity.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
const pgUrl = process.env.DATABASE_URL?.startsWith('pglite:') ? process.env.DATABASE_URL : 'pglite:memory';
const noCopy = process.argv.includes('--no-copy');

const pg = await openDb(pgUrl);
await migrateDb(pg.db, pgUrl);
if (!noCopy) {
  console.log('Reading MongoDB and copying into', pgUrl, '…');
  const report = await copyFromMongo(pg.db, await readMongo(mongoUri, 'pg-compare'), { write: true });
  console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
}
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare', autoIndex: false });

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
    const why = knownWhy(d);
    if (!why) return true;
    const k = known.get(why) ?? { count: 0, example: `${name} → ${describeDifference(d)}` };
    k.count++;
    known.set(why, k);
    return false;
  });
  const list = Array.isArray(p) ? p : (p as Page)?.customers;
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
