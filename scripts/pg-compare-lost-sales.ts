/**
 * Does the Lost Sales list answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-lost-sales.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET /api/lost-sales
 * through the real router as an admin and as a login at each branch (and a branch-less login),
 * so what each branch sees, and the order, is compared record by record. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createLostSalesRouter from '../src/routes/lostSales.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-lost-sales');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-lost-sales', autoIndex: false, autoCreate: false });

const sales: Loose[] = source.lostSales;
const names = [...new Set(sales.map(s => String(s.location ?? '')))].filter(Boolean).sort();
console.log(`${sales.length} lost sales, branches: ${names.join(', ') || '(none)'}.`);

const app = express();
app.use(express.json());
app.use('/api/lost-sales', createLostSalesRouter({
  verifyAnyAuth: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
}));

const VIEW = ['view_lost_sales'];
const asked = async (database: 'mongo' | 'postgres', user: Loose) => {
  process.env.DB_LOST_SALES = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get('/api/lost-sales').set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const droppedLinks = new Set<string>();
const compare = async (user: Loose) => {
  checked++;
  const [m, p] = [await asked('mongo', user), await asked('postgres', user)];
  if (m.status !== p.status) { problems.push(`${user.username}: status ${m.status} vs ${p.status}`); differences++; return; }
  if (m.body.length !== p.body.length) { problems.push(`${user.username}: ${m.body.length} records vs ${p.body.length}`); differences++; }
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 200)) {
    // A customer or rep id that no longer exists: MongoDB keeps the old id as text, Postgres has no link.
    if ((d.path.endsWith('customerId') || d.path.endsWith('salesRepId')) && d.mongo && !d.postgres) { droppedLinks.add(String(d.mongo)); continue; }
    if (problems.length < 400) problems.push(`${user.username}: ${describeDifference(d)}`);
    differences++;
  }
};

await compare({ username: 'admin', permissions: VIEW, assignedLocations: ['*'] });
for (const loc of names) await compare({ username: `at-${loc}`, permissions: VIEW, assignedLocations: [loc] });
await compare({ username: 'nowhere', permissions: VIEW, assignedLocations: [] });

console.log(`\n${checked} requests compared.`);
console.log(`customer / rep ids that are not a customer / user, blanked by the copy: ${droppedLinks.size} value(s): ${[...droppedLinks].join(' | ')}`);
console.log(`${differences} other differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
