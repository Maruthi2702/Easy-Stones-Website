/**
 * Does Check In (and the Selection Sheet) answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-checkins.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). GET requests through the
 * real router, as an admin and as a login for each branch: the log (plain, every page, every month
 * with check-ins, searches by name / phone / company), the counts, the phone lookup, each check-in by
 * id, and the PDF's status. Exit 0 = the same, apart from the two known differences below.
 *
 * Known differences (named, never hidden):
 * - a check-in saved before `status` existed has none on MongoDB and 'New' on Postgres (same to a screen);
 * - a check-in whose branch isn't a location has no branch on Postgres (listed, counted).
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createCheckInRouter from '../src/routes/checkIn.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-checkins');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-checkins', autoIndex: false, autoCreate: false });

const all: Loose[] = source.officeCheckIns;
const branches = [...new Set(all.map(c => String(c.location || '')).filter(Boolean))].sort();
const locationNames = new Set((source.locations as Loose[]).map(l => String(l.name)));
const notLocations = all.filter(c => !locationNames.has(String(c.location)));
console.log(`${all.length} check-ins at ${branches.length} branches; ${notLocations.length} with a branch that isn't a location.`);

const has = (req: Loose, p: string) => (req.user.permissions || []).includes(p);
const app = express();
app.use(express.json());
app.use('/api/checkin', createCheckInRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  requirePermission: (p: string) => (req: Loose, res: Loose, next: () => void) => (has(req, p) ? next() : res.status(403).json({}))
}));

const PERMS = ['view_checkins', 'create_checkins'];
const admin = { username: 'admin', permissions: PERMS, assignedLocations: ['*'] };
const atBranch = (b: string) => ({ username: `at-${b}`, permissions: PERMS, assignedLocations: [b] });

const asked = async (database: 'mongo' | 'postgres', user: Loose, url: string) => {
  process.env.DB_CHECKIN = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, type: r.type, body: r.type === 'application/json' ? r.body : null };
};

/** A check-in saved before `status` existed reads 'New' on Postgres. */
const withStatus = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(withStatus);
  if (v && typeof v === 'object') {
    const o = { ...(v as Loose) };
    for (const k of Object.keys(o)) o[k] = withStatus(o[k]);
    if ('phone' in o && 'name' in o && '_id' in o && !o.status) o.status = 'New';
    return o;
  }
  return v;
};

let checked = 0, differences = 0, unplaced = 0;
const problems: string[] = [];
const compare = async (user: Loose, url: string) => {
  checked++;
  const m = await asked('mongo', user, url);
  const p = await asked('postgres', user, url);
  if (m.status !== p.status) { problems.push(`${user.username} ${url}: status ${m.status} vs ${p.status}`); differences++; return; }
  if (!m.body) return;
  for (const d of diffEntries(normalize(withStatus(m.body)), normalize(withStatus(p.body)), 200)) {
    if (d.path.endsWith('location') && d.mongo && !d.postgres && notLocations.some(c => c.location === d.mongo)) { unplaced++; continue; }
    if (problems.length < 400) problems.push(`${user.username} ${url}: ${describeDifference(d)}`);
    differences++;
  }
};

const months = new Set<string>();
for (const c of all) { const d = new Date(c.createdAt); months.add(`${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`); }
const monthList = [...months].map(k => k.split('/')).sort((a, b) => Number(a[1]) * 20 + Number(a[0]) - (Number(b[1]) * 20 + Number(b[0])));

const total = all.length;
const pages = Math.ceil(total / 50);
console.log('The log: plain, every page, every month, per branch …');
for (const user of [admin, ...branches.map(atBranch)]) {
  await compare(user, '/api/checkin');
  await compare(user, '/api/checkin/stats');
  if (user === admin) {
    for (let page = 1; page <= pages; page++) await compare(user, `/api/checkin?page=${page}&limit=50`);
  } else {
    await compare(user, '/api/checkin?page=1&limit=1000');
  }
  for (const [m, y] of monthList) await compare(user, `/api/checkin?page=1&limit=1000&month=${m}&year=${y}`);
}
for (const b of branches) { await compare(admin, `/api/checkin?page=1&limit=1000&location=${encodeURIComponent(b)}`); await compare(admin, `/api/checkin/stats?location=${encodeURIComponent(b)}`); }

console.log('Searches …');
const sample = <T>(list: T[], n: number) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
const words = new Set<string>();
for (const c of sample(all, 150)) {
  for (const w of [String(c.name || '').split(/\s+/)[0], String(c.fabricatorCompany || '').split(/\s+/)[0]]) if (w && w.length > 2) words.add(w);
}
for (const w of words) await compare(admin, `/api/checkin?page=1&limit=1000&search=${encodeURIComponent(w)}`);
for (const c of sample(all, 120)) {
  const digits = String(c.phone || '').replace(/\D/g, '');
  if (digits.length >= 6) await compare(admin, `/api/checkin?page=1&limit=1000&search=${digits.slice(0, 7)}`);
}
for (const odd of ["O'", '(', '[', '$', '.*', '\\', 'a|b', '%', '_']) await compare(admin, `/api/checkin?page=1&limit=1000&search=${encodeURIComponent(odd)}`);

console.log('Phone lookups …');
const phones = [...new Set(all.map(c => String(c.phone || '').replace(/\D/g, '')).filter(d => d.length >= 10))];
for (const d of sample(phones, 400)) await compare(admin, `/api/checkin/lookup?phone=${d}`);
for (const b of branches) for (const d of sample(phones, 25)) await compare(atBranch(b), `/api/checkin/lookup?phone=${d}`);

console.log('Each check-in by id …');
for (const c of sample(all, 2500)) await compare(admin, `/api/checkin/${c._id}`);
for (const c of sample(all.filter(x => Array.isArray(x.selections) && x.selections.length), 400)) await compare(admin, `/api/checkin/${c._id}`);

console.log('The PDF …');
for (const [m, y] of monthList.slice(-3)) await compare(admin, `/api/checkin/export.pdf?month=${m}&year=${y}`);

console.log(`\n${checked} requests compared.`);
console.log(`${unplaced} branch value(s) on check-ins whose branch isn't a location (known).`);
console.log(`${differences} other differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
