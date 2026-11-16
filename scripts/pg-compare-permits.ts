/**
 * Does Permits answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-permits.ts
 *
 * Reads MongoDB only (MONGO_URI), never writes it. Postgres is PGlite in memory (never RDS). It drives the real Permits
 * router (src/permits/router.ts) over HTTP with a stand-in login, once with DB_PERMITS unset (MongoDB) and once with
 * DB_PERMITS=postgres, so whatever data layer the router calls (src/db/permits/) is what is compared:
 *   - the page's meta (sources with last runs, month checks, cities and their counties),
 *   - the list for every source and every county, then by category, by each city (counts by category included),
 *     a value floor, a date window, a text search, page 2 and each sort,
 *   - the export (Excel rows) for the same filters,
 *   - the contractor pop-up for licenses seen on permits (the registry call is stubbed: only our own half is compared),
 *   - then the copy's own row check for the `permits` scope.
 * Nothing here names a data-layer function, so it keeps working as that layer changes. Exit 0 = the same.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import mongoose from 'mongoose';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo, verifyArea } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createPermitsRouter from '../src/permits/router.ts';
import { ALL_PERMIT_PERMISSIONS } from '../src/permits/permissions.ts';
import { SOURCE_IDS, SOURCES } from '../src/permits/permitRules.ts';
import '../src/models/User.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-permits');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-permits', autoIndex: false, autoCreate: false });
console.log(`${source.permits.length} permits, ${source.permitRuns.length} runs, ${source.permitChecks.length} month checks, ${source.permitContractors.length} contractors, ${source.permitContractorNames.length} registry names.`);

// The registry is the state's website: stand in for it, so only our own side of the pop-up is compared.
const contractors = {
  profile: async (license: string) => ({ found: false, license, businessName: '', verifyUrl: '' }),
  forPermits: async () => new Map(),
  lookup: async () => null
};
const app = express();
app.use(express.json());
const login = { id: 'compare', displayName: 'Compare', permissions: [...ALL_PERMIT_PERMISSIONS] };
app.use('/api/permits', createPermitsRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = login; req.userId = login.id; next(); },
  sync: null, contractors, customerIndexMs: 0
}));
const server = http.createServer(app);
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/permits`;

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 100) problems.push(line); differences++; };
const on = (database: 'mongo' | 'postgres') => { process.env.DB_PERMITS = database === 'postgres' ? 'postgres' : ''; };
// Fields that are about the moment of asking, not the data.
const tidy = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'running' ? undefined : x)));

async function compare(label: string, path: string) {
  checked++;
  const ask = async (db: 'mongo' | 'postgres') => {
    on(db);
    try {
      const res = await fetch(`${base}${path}`);
      const type = res.headers.get('content-type') || '';
      if (!type.includes('json')) return { status: res.status, bytes: (await res.arrayBuffer()).byteLength };
      return { status: res.status, body: tidy(await res.json()) };
    } catch (e) { return { error: String((e as Error).message).slice(0, 80) }; }
  };
  const [m, p] = [await ask('mongo'), await ask('postgres')];
  for (const d of diffEntries(normalize(m), normalize(p), 50)) note(`${label}: ${describeDifference(d)}`);
}
const qs = (o: Record<string, string | number>) => '?' + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

await compare('meta', '/meta');
await compare('list (all)', '/' + qs({ limit: 100 }));
await compare('list page 2', '/' + qs({ limit: 50, page: 2 }));
for (const sort of ['issued_desc', 'issued_asc', 'value_desc', 'value_asc']) await compare(`list sort ${sort}`, '/' + qs({ limit: 50, sort }));

// Every source, and every county.
for (const id of SOURCE_IDS) await compare(`source ${id}`, '/' + qs({ source: id, limit: 100 }));
const counties = [...new Set(SOURCE_IDS.map(id => (SOURCES as Loose)[id].county).filter(Boolean))] as string[];
for (const county of counties) await compare(`county ${county}`, '/' + qs({ counties: county, limit: 100 }));
if (counties.length > 1) await compare('two counties', '/' + qs({ counties: counties.slice(0, 2).join(','), limit: 100 }));

// Counts by category, city and source.
const categories = [...new Set(source.permits.map((p: Loose) => String(p.category || '')).filter(Boolean))];
for (const category of categories) await compare(`category ${category}`, '/' + qs({ category, limit: 100 }));
const cities = [...new Set(source.permits.map((p: Loose) => String(p.city || '')).filter(Boolean))].sort();
for (const city of cities) await compare(`city ${city}`, '/' + qs({ city, limit: 100 }));
await compare('value floor', '/' + qs({ minValue: 500000, limit: 100 }));
const days = source.permits.map((p: Loose) => (p.issuedOn ? new Date(p.issuedOn).toISOString().slice(0, 10) : '')).filter(Boolean).sort();
if (days.length) {
  const from = days[Math.floor(days.length / 2)], to = days[days.length - 1];
  await compare('date window', '/' + qs({ from, to, limit: 100 }));
  await compare('window by source', '/' + qs({ from, to, source: SOURCE_IDS[0], limit: 100 }));
}
for (const q of ['ave', 'construction', 'llc']) await compare(`search "${q}"`, '/' + qs({ q, limit: 100 }));
const numbers = source.permits.slice(0, 20).map((p: Loose) => String(p.permitNumber || '')).filter(Boolean);
for (const q of numbers) await compare(`search permit ${q}`, '/' + qs({ q }));

// Export (Excel rows) for a few filters.
await compare('export (all)', '/export');
for (const id of SOURCE_IDS.slice(0, 5)) await compare(`export ${id}`, '/export' + qs({ source: id }));

// Contractor pop-up: every license that shows on permits (capped), by the permits-here half.
const licenses = [...new Set(source.permits.flatMap((p: Loose) => (Array.isArray(p.contacts) ? p.contacts : []).map((c: Loose) => String(c.license || '').toUpperCase()).filter(Boolean)))] as string[];
for (const lic of licenses.slice(0, 60)) await compare(`contractor ${lic}`, `/contractor/${encodeURIComponent(lic)}`);
if (licenses.length) await compare('list by license', '/' + qs({ license: licenses[0], limit: 100 }));
console.log(`${categories.length} categories, ${cities.length} cities, ${licenses.length} licenses seen.`);

checked++;
for (const d of await verifyArea(pg.db, source, 'permits')) note(`rows: ${d}`);

console.log(`\n${checked} checks, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
server.close();
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
