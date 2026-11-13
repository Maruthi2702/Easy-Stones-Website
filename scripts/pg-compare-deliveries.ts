/**
 * Does the Delivery Schedule answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-deliveries.ts
 *
 * Reads MongoDB only (MONGO_URI): the copy reads it, and the checks below are GET requests
 * through the real router. Postgres is PGlite in memory (never RDS). Prints every
 * difference; exit 0 = the same everywhere.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createDeliveriesRouter from '../src/routes/deliveries.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-deliveries');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-deliveries', autoIndex: false, autoCreate: false });

const tickets: Loose[] = source.deliveries;
const branches: string[] = source.locations.map((l: Loose) => String(l.name));
console.log(`${tickets.length} tickets, ${branches.length} branches.`);

// Tickets whose stored branch is not a location: Postgres can only read them as having no branch.
const unknownBranch = tickets.filter(d => d.location && !branches.includes(String(d.location)));
const unknownDestination = tickets.filter(d => d.transferDestination && !branches.includes(String(d.transferDestination)));
console.log(`Stored branch not a location: ${unknownBranch.length}; transfer destination not a location: ${unknownDestination.length}.`);
for (const d of [...unknownBranch, ...unknownDestination].slice(0, 10)) {
  console.log(`  ${d.id} location=${JSON.stringify(d.location)} destination=${JSON.stringify(d.transferDestination)}`);
}

const app = express();
app.use(express.json());
app.set('io', { emit: () => {}, to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: { keys: () => [][Symbol.iterator]() } } } });
const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
app.use('/api', createDeliveriesRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  requirePermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.every(p => has(req, p)) ? next() : res.status(403).json({})),
  requireAnyPermission: (...ps: string[]) => (req: Loose, res: Loose, next: () => void) => (ps.some(p => has(req, p)) ? next() : res.status(403).json({})),
  getPerformerInfo: async () => ({}),
  processBase64Images: async (x: unknown[]) => x,
  getNowLocalISO: () => new Date().toISOString()
}));

const VIEW = ['view_delivery_schedule'];
const viewers: Loose[] = [
  { username: 'admin', permissions: VIEW, assignedLocations: ['*'] },
  ...branches.map(b => ({ username: `at-${b}`, permissions: VIEW, assignedLocations: [b] })),
  { username: 'two', permissions: VIEW, assignedLocations: branches.slice(0, 2) }
];

// Weeks around the tickets' own dates (Monday to Sunday), newest 30 weeks plus the next 2.
const days = tickets.map(d => String(d.date || '')).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
const last = days[days.length - 1] || new Date().toISOString().slice(0, 10);
const weeks: string[] = [];
for (let i = -30; i <= 2; i++) weeks.push(addDays(mondayOf(last), i * 7));

const searchTerms = [...new Set(tickets.map(d => String(d.customerName || '').split(/\s+/)[0]).filter(w => w.length >= 3))].slice(0, 25);
const soNumbers = [...new Set(tickets.map(d => String(d.soNumber || '')).filter(Boolean))].slice(0, 10);

const asked = async (database: 'mongo' | 'postgres', user: Loose, url: string) => {
  process.env.DB_DELIVERIES = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

let checked = 0;
let differences = 0;
const problems: string[] = [];
const droppedCustomerIds = new Set<string>();
/**
 * Old tickets lack fields added later (customerDropOff, numberOfSlabs, pod.verified); Postgres holds
 * their defaults. false, 0 and an empty proof read the same to every screen, so they are set aside.
 */
const settle = (v: unknown) => normalize(JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x === false || x === 0 ? undefined : x))));
const compare = async (user: Loose, url: string) => {
  checked++;
  const [m, p] = [await asked('mongo', user, url), await asked('postgres', user, url)];
  if (m.status !== p.status) { problems.push(`${user.username} ${url}: status ${m.status} vs ${p.status}`); return; }
  // Lists whose order is a tie: compare as sets by ticket id.
  const sorted = (b: unknown) => Array.isArray(b) ? [...b].sort((a: Loose, c: Loose) => String(a.id).localeCompare(String(c.id))) : b;
  const sortedResults = (b: Loose) => b && Array.isArray(b.results) ? { ...b, results: sorted(b.results) } : b;
  const diffs = diffEntries(settle(sortedResults(sorted(m.body) as Loose)), settle(sortedResults(sorted(p.body) as Loose)), 500);
  for (const d of diffs) {
    // A customerId that names no customer (a company name, or a customer since deleted): the copy blanks it.
    if (d.path.endsWith('customerId') && d.mongo && !d.postgres) { droppedCustomerIds.add(String(d.mongo)); continue; }
    if (problems.length < 400) problems.push(`${user.username} ${url}: ${describeDifference(d)}`);
    differences++;
  }
};

if (process.env.ONLY_SEARCH) {
  // Debug one search: which tickets does only one database show, and on what dates?
  const user = viewers.find(v => v.username === 'at-Seattle')!;
  const url = `/api/deliveries/search?q=${encodeURIComponent(process.env.ONLY_SEARCH)}`;
  const [m, p] = [await asked('mongo', user, url), await asked('postgres', user, url)];
  const idsOf = (b: Loose) => b.results.map((r: Loose) => `${r.date || '(none)'} ${r.id}`);
  const mine = new Set(idsOf(m.body)), theirs = new Set(idsOf(p.body));
  console.log(`total mongo ${m.body.total} / postgres ${p.body.total}; more ${m.body.more} / ${p.body.more}`);
  console.log('oldest date shown: mongo', idsOf(m.body).map(x => x.split(' ')[0]).sort()[0], '· postgres', idsOf(p.body).map(x => x.split(' ')[0]).sort()[0]);
  console.log('only in mongo:', [...mine].filter(x => !theirs.has(x)).sort());
  console.log('only in postgres:', [...theirs].filter(x => !mine.has(x)).sort());
  process.exit(0);
}
console.log('Board weeks, Pending and Cancelled for every branch login and an admin …');
for (const user of viewers) {
  for (const w of weeks) await compare(user, `/api/deliveries?startDate=${w}&endDate=${addDays(w, 6)}`);
  await compare(user, '/api/deliveries?pending=true');
  await compare(user, '/api/deliveries?cancelled=true');
}
console.log('Order search …');
for (const user of [viewers[0], viewers[1], viewers[viewers.length - 1]]) {
  for (const q of [...searchTerms, ...soNumbers]) await compare(user, `/api/deliveries/search?q=${encodeURIComponent(q)}`);
}
console.log('Every ticket by id as an admin …');
for (const d of tickets) await compare(viewers[0], `/api/deliveries/${encodeURIComponent(String(d.id))}`);
console.log('Trucks …');
await compare(viewers[0], '/api/trucks');

console.log(`\n${checked} requests compared.`);
console.log(`customerId that is not a customer, blanked by the copy: ${droppedCustomerIds.size} value(s): ${[...droppedCustomerIds].join(' | ')}`);
console.log(`${differences} other differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
