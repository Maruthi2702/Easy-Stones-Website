/**
 * Do Cart & Holds answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-holds.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). Through the real router, as an admin
 * and as a login at each branch: the hold list (every scope and status tab, search, a day range, pages), every
 * hold with its history, every person's cart and the slab status of every held slab — each asked of MongoDB
 * then of Postgres and compared record by record. Nothing is written. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createHoldsRouter from '../src/holds/router.ts';
import { ALL_HOLD_PERMISSIONS } from '../src/holds/permissions.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-holds');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-holds', autoIndex: false, autoCreate: false });

const holds: Loose[] = source.salesHolds;
const carts: Loose[] = source.salesCarts;
const reservations: Loose[] = source.salesSlabReservations;
const branches = [...new Set(holds.map(h => String(h.branch ?? '')))].filter(Boolean).sort();
console.log(`${holds.length} holds (${branches.join(', ') || 'no branches'}), ${carts.length} carts, ${reservations.length} locks.`);

const app = express();
app.use(express.json());
app.use('/api/holds', createHoldsRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
}));

const ADMIN = { id: 'compare-admin', username: 'admin', displayName: 'Admin', permissions: [...ALL_HOLD_PERMISSIONS], assignedLocations: ['*'] };
const atBranch = (b: string) => ({ ...ADMIN, id: `compare-${b}`, username: `at-${b}`, assignedLocations: [b], location: b });

type Ask = (database: 'mongo' | 'postgres') => Promise<{ status: number; body: Loose }>;
const ask = (user: Loose, method: 'get' | 'post', url: string, body?: Loose): Ask => async (database) => {
  process.env.DB_HOLDS = database === 'postgres' ? 'postgres' : '';
  const r = await request(app)[method](`/api/holds${url}`).set('x-test-user', JSON.stringify(user)).send(body);
  return { status: r.status, body: r.body };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 400) problems.push(line); differences++; };
const compare = async (label: string, send: Ask) => {
  checked++;
  const [m, p] = [await send('mongo'), await send('postgres')];
  if (m.status !== p.status) return note(`${label}: status ${m.status} vs ${p.status}`);
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 50)) {
    // A deleted customer: MongoDB keeps the id as text, Postgres has no link (the one intended difference, src/db/holds/README.md).
    if (/customer\.id$/.test(d.path) && d.mongo && !d.postgres) continue;
    note(`${label}: ${describeDifference(d)}`);
  }
};

const tabs = ['active', 'expiring', 'expired', 'released', 'converted', 'all'];
for (const status of tabs) {
  await compare(`list all/${status}`, ask(ADMIN, 'get', `?scope=all&status=${status}&limit=100`));
  await compare(`list mine/${status}`, ask(ADMIN, 'get', `?scope=mine&status=${status}&limit=100`));
  for (const b of branches) await compare(`list ${b}/${status}`, ask(atBranch(b), 'get', `?scope=branch&status=${status}&limit=100`));
}
await compare('list page 2', ask(ADMIN, 'get', '?scope=all&status=all&limit=25&page=2'));
const sample = holds[0];
if (sample) {
  const name = String(sample.customer?.name ?? '').split(' ')[0];
  if (name) await compare(`search "${name}"`, ask(ADMIN, 'get', `?scope=all&status=all&search=${encodeURIComponent(name)}`));
  await compare('search by number', ask(ADMIN, 'get', `?scope=all&status=all&search=${sample.number}`));
  if (sample.slabKeys?.[0]) await compare('search by slab', ask(ADMIN, 'get', `?scope=all&status=all&search=${encodeURIComponent(sample.slabKeys[0])}`));
  const day = new Date(sample.createdAt).toISOString().slice(0, 10);
  await compare('one day', ask(ADMIN, 'get', `?scope=all&status=all&from=${day}&to=${day}`));
}
for (const h of holds) await compare(`hold #${h.number}`, ask(ADMIN, 'get', `/${h._id}`));
for (const c of carts) await compare(`cart of ${c.userName || c.userId}`, ask({ ...ADMIN, id: String(c.userId) }, 'get', '/cart'));
const keys = [...new Set(reservations.map(r => String(r.slabKey)))];
for (let i = 0; i < keys.length; i += 300) await compare(`slab status ${i}`, ask(ADMIN, 'post', '/slabs/status', { slabKeys: keys.slice(i, i + 300) }));

console.log(`\n${checked} requests compared, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
