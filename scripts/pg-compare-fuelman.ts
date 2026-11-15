/**
 * Does Fuel Man answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-fuelman.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). Through the real router, as a
 * company-wide login and as a reader at each branch: the report list (pages), every report's detail, its
 * lines (several filters), history and original PDF, and the P&L (and its CSV) for every month — each asked of
 * MongoDB then of Postgres and compared record by record. Nothing is written. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyAreaFromMongo, verifyArea } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createFuelManRouter from '../src/fuelman/router.ts';
import { ALL_FUEL_MAN_PERMISSIONS } from '../src/fuelman/permissions.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-fuelman');
const report = await copyAreaFromMongo(pg.db, source, 'fuelman', { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} Fuel Man rows (${report.problems.length} problems reported by the copy).`);
for (const d of await verifyArea(pg.db, source, 'fuelman')) console.log('  copy check:', d);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { appName: 'pg-compare-fuelman', autoIndex: false, autoCreate: false });

const reports: Loose[] = source.fuelReports;
const months = [...new Set(reports.map(r => String(r.parsed?.month ?? '')))].filter(Boolean).sort();
const branches = [...new Set((source.fuelExpenses as Loose[]).map(e => String(e.location ?? '')))].filter(Boolean).sort();
console.log(`${reports.length} reports (${months.join(', ') || 'no months'}), ${(source.fuelExpenses as Loose[]).length} published costs, ${(source.fuelAssignments as Loose[]).length} card assignments.`);

const app = express();
app.use(express.json());
app.use('/api/accounting/fuel-man', createFuelManRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); }
}));

const FINANCE = { id: 'compare-finance', username: 'finance', displayName: 'Finance', permissions: [...ALL_FUEL_MAN_PERMISSIONS], assignedLocations: ['*'] };
const atBranch = (b: string) => ({ ...FINANCE, id: `compare-${b}`, username: `at-${b}`, assignedLocations: [b] });

type Answer = { status: number; body: Loose; file?: string };
type Ask = (database: 'mongo' | 'postgres') => Promise<Answer>;
const ask = (user: Loose, url: string): Ask => async database => {
  process.env.DB_FUELMAN = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(`/api/accounting/fuel-man${url}`).set('x-test-user', JSON.stringify(user))
    .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const raw = r.body as Buffer;
  const isJson = String(r.headers['content-type'] || '').includes('json');
  return isJson ? { status: r.status, body: raw.length ? JSON.parse(raw.toString()) : {} } : { status: r.status, body: {}, file: createHash('sha256').update(raw).digest('hex') };
};

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 400) problems.push(line); differences++; };
const compare = async (label: string, send: Ask) => {
  checked++;
  const [m, p] = [await send('mongo'), await send('postgres')];
  if (m.status !== p.status) return note(`${label}: status ${m.status} vs ${p.status}`);
  if (m.file !== p.file) note(`${label}: file differs`);
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 50)) note(`${label}: ${describeDifference(d)}`);
};

await compare('revision', ask(FINANCE, '/revision'));
await compare('metadata', ask(FINANCE, '/metadata'));
for (const q of ['', '?page=2', '?limit=25', '?limit=100']) await compare(`list ${q || '(first page)'}`, ask(FINANCE, `/reports${q}`));
for (const b of branches) await compare(`list at ${b}`, ask(atBranch(b), '/reports?limit=100'));
for (const r of reports) {
  const id = String(r._id), label = `${r.parsed?.month} r${r.revision} (${r.status})`;
  await compare(`detail ${label}`, ask(FINANCE, `/reports/${id}`));
  await compare(`lines ${label}`, ask(FINANCE, `/reports/${id}/lines?limit=100`));
  await compare(`lines unknown ${label}`, ask(FINANCE, `/reports/${id}/lines?unknown=true&limit=100`));
  await compare(`lines fuel ${label}`, ask(FINANCE, `/reports/${id}/lines?category=fuel&limit=25&page=2`));
  await compare(`history ${label}`, ask(FINANCE, `/reports/${id}/history`));
  await compare(`pdf ${label}`, ask(FINANCE, `/reports/${id}/source`));
  if (r.status === 'posted') for (const b of branches) {
    await compare(`detail ${label} at ${b}`, ask(atBranch(b), `/reports/${id}`));
    await compare(`lines ${label} at ${b}`, ask(atBranch(b), `/reports/${id}/lines?limit=100`));
  }
}
for (const month of months) {
  await compare(`P&L ${month}`, ask(FINANCE, `/pnl?month=${month}`));
  await compare(`P&L CSV ${month}`, ask(FINANCE, `/pnl?month=${month}&format=csv`));
  for (const b of branches) await compare(`P&L ${month} at ${b}`, ask(atBranch(b), `/pnl?month=${month}`));
}

console.log(`\n${checked} requests compared, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
