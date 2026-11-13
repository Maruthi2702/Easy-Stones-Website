/**
 * Does the Payments page answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-payments.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET requests
 * through the real router: every branch + day that has payments (list and summary), the
 * combined "all branches" list per day, as a branch login and an admin. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createPaymentsReceivedRouter from '../src/routes/paymentsReceived.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-payments');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-payments', autoIndex: false, autoCreate: false });

const payments: Loose[] = source.paymentsReceived;
const pairs = [...new Set(payments.map(p => `${p.location}|${p.date}`))].map(k => k.split('|') as [string, string]);
const days = [...new Set(payments.map(p => String(p.date)))].sort();
console.log(`${payments.length} payments, ${pairs.length} branch-days, ${days.length} days.`);

const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const app = express();
app.use(express.json());
app.use('/api/payments-received', createPaymentsReceivedRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
}));

const VIEW = ['view_payments'];
const asked = async (database: 'mongo' | 'postgres', user: Loose, url: string) => {
  process.env.DB_PAYMENTS = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const droppedCustomerIds = new Set<string>();
const sortPayments = (b: Loose) => b && Array.isArray(b.payments) ? { ...b, payments: [...b.payments].sort((a: Loose, c: Loose) => String(a.id ?? a._id).localeCompare(String(c.id ?? c._id))) } : b;
const compare = async (user: Loose, url: string) => {
  checked++;
  const [m, p] = [await asked('mongo', user, url), await asked('postgres', user, url)];
  if (m.status !== p.status) { problems.push(`${user.username} ${url}: status ${m.status} vs ${p.status}`); differences++; return; }
  // `today` is the clock, not data.
  for (const d of diffEntries(normalize(sortPayments(m.body)), normalize(sortPayments(p.body)), 200)) {
    if (d.path.endsWith('customerId') && d.mongo && !d.postgres) { droppedCustomerIds.add(String(d.mongo)); continue; }
    if (problems.length < 400) problems.push(`${user.username} ${url}: ${describeDifference(d)}`);
    differences++;
  }
};

const admin = { username: 'admin', permissions: VIEW, assignedLocations: ['*'] };
console.log('Branch-day lists and summaries …');
for (const [loc, date] of pairs) {
  const q = `location=${encodeURIComponent(loc)}&date=${date}`;
  const user = { username: `at-${loc}`, permissions: VIEW, assignedLocations: [loc] };
  await compare(user, `/api/payments-received?${q}`);
  await compare(user, `/api/payments-received/summary?${q}`);
  await compare(admin, `/api/payments-received?${q}`);
}
console.log('All-branches list per day …');
for (const date of days) await compare(admin, `/api/payments-received?location=*&date=${date}`);

console.log(`\n${checked} requests compared.`);
console.log(`customerId that is not a customer, blanked by the copy: ${droppedCustomerIds.size} value(s): ${[...droppedCustomerIds].join(' | ')}`);
console.log(`${differences} other differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
