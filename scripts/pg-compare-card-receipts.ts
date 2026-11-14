/**
 * Does Credit Card Receipts answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-card-receipts.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET requests
 * through the real router: /me for every cardholder, the category list, the cards (Admin),
 * each month's list as each cardholder, as view-all, and what waits for each approver.
 * Exit 0 = the same. Refuses to run with no categories: the route would seed them (a write).
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createCardReceiptsRouter from '../src/routes/cardReceipts.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-card-receipts');
if (!source.receiptCategories.length) { console.error('No receipt categories on MongoDB: a GET would seed them. Stopping.'); process.exit(1); }
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-card-receipts', autoIndex: false, autoCreate: false });

const expenses: Loose[] = source.cardExpenses;
const cards: Loose[] = source.companyCards;
const months = [...new Set(expenses.map(e => String(e.month)))].sort();
const holders = [...new Set([...cards.map(c => String(c.userId)), ...expenses.map(e => String(e.userId))])];
const users = new Map<string, Loose>((source.users as Loose[]).map(u => [String(u._id), u]));
console.log(`${expenses.length} expenses, ${cards.length} cards, ${source.receiptCategories.length} categories, ${months.length} months, ${holders.length} cardholders.`);

const app = express();
app.use(express.json());
app.use('/api/card-receipts', createCardReceiptsRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  processBase64Image: async () => ''
}));

const asked = async (database: 'mongo' | 'postgres', user: Loose, url: string) => {
  process.env.DB_CARD_RECEIPTS = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(`/api/card-receipts${url}`).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const droppedLinks = new Set<string>();
const compare = async (who: string, user: Loose, url: string) => {
  checked++;
  const [m, p] = [await asked('mongo', user, url), await asked('postgres', user, url)];
  if (m.status !== p.status) { problems.push(`${who} ${url}: status ${m.status} vs ${p.status}`); differences++; return; }
  // `today` is the clock, not data.
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 200)) {
    // A link to a customer / person / card that no longer exists is blanked by the copy (reported above).
    if (/(customerId|userId|cardId)$/.test(d.path) && d.mongo && !d.postgres) { droppedLinks.add(`${d.path.split('.').pop()}:${d.mongo}`); continue; }
    if (problems.length < 400) problems.push(`${who} ${url}: ${describeDifference(d)}`);
    differences++;
  }
};

const person = (id: string, perms: string[]): Loose => {
  const u = users.get(id) ?? {};
  return { id, displayName: u.displayName, username: u.username, role: u.role, location: u.location, assignedLocations: u.assignedLocations, permissions: perms };
};
const ADMIN_PERMS = ['view_all_card_receipts', 'manage_company_cards', 'approve_card_receipts', 'use_card_receipts'];
const admin = person(holders[0] ?? 'x', ADMIN_PERMS);

console.log('Me, categories, cards …');
await compare('admin', admin, '/categories');
await compare('admin', admin, '/cards');
for (const id of holders) await compare(users.get(id)?.username ?? id, person(id, ['use_card_receipts']), '/me');
console.log('Months and what is waiting …');
for (const id of holders) {
  const who = users.get(id)?.username ?? id;
  for (const month of months) await compare(who, person(id, ['use_card_receipts']), `/expenses?month=${month}`);
  await compare(who, person(id, ['use_card_receipts', 'approve_card_receipts']), '/expenses?scope=waiting');
}
for (const month of months) await compare('view-all', { ...admin, id: 'viewer' }, `/expenses?scope=all&month=${month}`);

console.log(`\n${checked} requests compared.`);
console.log(`links to something that no longer exists, blanked by the copy: ${droppedLinks.size} value(s): ${[...droppedLinks].join(' | ')}`);
console.log(`${differences} other differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
