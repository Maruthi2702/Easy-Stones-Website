/**
 * Does Accounting (3rd-party freight) answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-accounting.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). Through the real router, as an admin
 * and as a login at each branch: the charge list (every tab, each branch, each carrier, pages, the export), every
 * charge with its history, the carriers, the invoice list and every invoice, and every payment by its id — each
 * asked of MongoDB then of Postgres and compared record by record. Nothing is written. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createAccountingRouter from '../src/accounting/router.ts';
import { ALL_ACCOUNTING_PERMISSIONS } from '../src/accounting/permissions.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-accounting');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-accounting', autoIndex: false, autoCreate: false });

const charges: Loose[] = source.acctFreightCharges, invoices: Loose[] = source.acctCarrierInvoices, payments: Loose[] = source.acctPayments, carriers: Loose[] = source.acctCarriers;
const branches = [...new Set(charges.map(c => String(c.location ?? '')))].filter(Boolean).sort();
console.log(`${charges.length} charges (${branches.join(', ') || 'no branches'}), ${carriers.length} carriers, ${invoices.length} invoices, ${payments.length} payments.`);

const app = express();
app.use(express.json());
app.use('/api/accounting', createAccountingRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
}));

const ADMIN = { id: 'compare-admin', username: 'admin', displayName: 'Admin', permissions: [...ALL_ACCOUNTING_PERMISSIONS], assignedLocations: ['*'] };
const atBranch = (b: string) => ({ ...ADMIN, id: `compare-${b}`, username: `at-${b}`, assignedLocations: [b] });

type Ask = (database: 'mongo' | 'postgres') => Promise<{ status: number; body: Loose }>;
const ask = (user: Loose, url: string): Ask => async (database) => {
  process.env.DB_ACCOUNTING = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(`/api/accounting${url}`).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 400) problems.push(line); differences++; };
const compare = async (label: string, send: Ask) => {
  checked++;
  const [m, p] = [await send('mongo'), await send('postgres')];
  if (m.status !== p.status) return note(`${label}: status ${m.status} vs ${p.status}`);
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 50)) note(`${label}: ${describeDifference(d)}`);
};

const tabs = ['to_approve', 'draft', 'approved', 'paid', 'void', 'all', 'flagged', 'missing_price'];
for (const [who, user] of [['admin', ADMIN], ...branches.map(b => [b, atBranch(b)] as const)] as const) {
  for (const tab of tabs) {
    await compare(`${who} list ${tab}`, ask(user, `/freight-charges?status=${tab}&limit=100`));
    await compare(`${who} list ${tab} page 2`, ask(user, `/freight-charges?status=${tab}&limit=25&page=2`));
  }
  await compare(`${who} export`, ask(user, '/freight-charges/export?status=all'));
  await compare(`${who} carriers`, ask(user, '/carriers'));
  await compare(`${who} invoices`, ask(user, '/carrier-invoices?status=all&limit=100'));
}
for (const b of branches) await compare(`admin list at ${b}`, ask(ADMIN, `/freight-charges?status=all&location=${encodeURIComponent(b)}&limit=100`));
for (const c of carriers) await compare(`list carrier ${c._id}`, ask(ADMIN, `/freight-charges?status=all&carrierId=${c._id}&limit=100`));
for (const q of ['bol', '1', 'pay-', 'freight']) await compare(`search ${q}`, ask(ADMIN, `/freight-charges?status=all&search=${q}`));
for (const c of charges) {
  await compare(`charge ${c._id}`, ask(ADMIN, `/freight-charges/${c._id}`));
  await compare(`charge ${c._id} as ${c.location}`, ask(atBranch(String(c.location ?? '')), `/freight-charges/${c._id}`));
}
for (const i of invoices) await compare(`invoice ${i._id}`, ask(ADMIN, `/carrier-invoices/${i._id}`));
for (const p of payments) await compare(`payment ${p.paymentId}`, ask(ADMIN, `/payments/${p.paymentId}`));

console.log(`\n${checked} requests, ${differences} differences.`);
for (const line of problems) console.log(`  ${line}`);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
