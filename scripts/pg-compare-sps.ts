/**
 * Do the SPS import's read routes answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-sps.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET requests
 * through the real router, as an importer: history, each run, its report.csv, its items
 * for every result, and its customer ids. Writes nothing anywhere. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createRouter from '../src/routes/customerSpsImport.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-sps');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-sps', autoIndex: false, autoCreate: false });

const runs: Loose[] = source.spsImportRuns;
console.log(`${runs.length} runs, ${source.spsImportItems.length} items.`);

const app = express();
app.use(express.json());
app.use('/api/customers', createRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  uploadMemory: multer({ storage: multer.memoryStorage() }),
  readSheet: async () => { throw new Error('read-only comparison: no uploads'); },
  resolveMapping: (() => ({})) as never,
  buildReference: async () => ({}),
  rememberAliases: async () => undefined,
  fields: []
}));

const user = { username: 'compare', permissions: ['view_customers', 'import_customers'] };
const BASE = '/api/customers/sps-import/runs';
const asked = async (database: 'mongo' | 'postgres', url: string) => {
  process.env.DB_CUSTOMERS = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body && Object.keys(r.body).length ? r.body : r.text };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const compare = async (url: string) => {
  checked++;
  const [m, p] = [await asked('mongo', url), await asked('postgres', url)];
  if (m.status !== p.status) { problems.push(`${url}: status ${m.status} vs ${p.status}`); differences++; return; }
  if (typeof m.body === 'string' || typeof p.body === 'string') {
    if (m.body !== p.body) { problems.push(`${url}: text differs`); differences++; }
    return;
  }
  // `/customers` is a set of ids for a filter; MongoDB's order there is its index's, so compare sorted.
  const setOf = (b: Loose) => (url.includes('/customers?') && Array.isArray(b?.ids) ? { ...b, ids: [...b.ids].sort() } : b);
  for (const d of diffEntries(normalize(setOf(m.body)), normalize(setOf(p.body)), 100)) {
    if (problems.length < 400) problems.push(`${url}: ${describeDifference(d)}`);
    differences++;
  }
};

await compare(BASE);
await compare(`${BASE}/current`);
const results = ['', 'added', 'updated', 'connected', 'unchanged', 'skipped', 'failed', 'restored'];
for (const run of runs) {
  const id = String(run._id);
  console.log(`Run ${id} (${run.status}) …`);
  await compare(`${BASE}/${id}`);
  await compare(`${BASE}/${id}/report.csv`);
  for (const outcome of ['added', 'updated']) await compare(`${BASE}/${id}/customers?outcome=${outcome}`);
  for (const result of results) await compare(`${BASE}/${id}/items?limit=100&page=1${result ? `&result=${result}` : ''}`);
}

console.log(`\n${checked} requests compared.`);
console.log(`${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
