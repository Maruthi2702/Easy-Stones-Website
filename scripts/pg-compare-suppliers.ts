/**
 * Do Supplier POs and the supplier portal answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-suppliers.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). Through the real routers: as an admin
 * the suppliers tab, the PO list for every status, every PO, the review and final queues, every sent block and
 * Incoming material; as each supplier login (a token signed here, never sent anywhere) its POs and blocks — each
 * asked of MongoDB then of Postgres and compared record by record. Nothing is written: the portal's "last seen"
 * is switched off for the run (SUPPLIERS_WRITES_PAUSED). Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createSuppliersRouter from '../src/routes/suppliers.ts';
import createSupplierPortalRouter from '../src/routes/supplierPortal.ts';
import { signSupplierToken } from '../src/services/supplierSession.ts';
import { ALL_SUPPLIER_PERMISSIONS } from '../src/utils/supplierAccess.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
process.env.SUPPLIERS_WRITES_PAUSED = 'true';

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-suppliers');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-suppliers', autoIndex: false, autoCreate: false });

const pos: Loose[] = source.supplierPos, blocks: Loose[] = source.supplierBlocks, logins: Loose[] = source.supplierLogins;
console.log(`${source.suppliers.length} suppliers, ${logins.length} logins, ${pos.length} POs, ${blocks.length} blocks.`);

const SECRET = 'compare-only-secret';
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/suppliers', createSuppliersRouter({ authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); } }));
app.use('/api/supplier-portal', createSupplierPortalRouter({ jwtSecret: SECRET, loginLimiter: (_q, _r, next) => next(), processBase64Image: async () => '' }));

const ADMIN = { id: 'compare-admin', username: 'admin', displayName: 'Admin', permissions: [...ALL_SUPPLIER_PERMISSIONS] };

type Ask = (database: 'mongo' | 'postgres') => Promise<{ status: number; body: Loose }>;
const ask = (headers: Record<string, string>, url: string): Ask => async (database) => {
  process.env.DB_SUPPLIERS = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set(headers);
  return { status: r.status, body: r.body };
};
const staff = (url: string) => ask({ 'x-test-user': JSON.stringify(ADMIN) }, `/api/suppliers${url}`);
const asLogin = (l: Loose, url: string) =>
  ask({ Cookie: `supplierToken=${signSupplierToken({ _id: String(l._id), supplierId: String(l.supplierId), sessionVersion: Number(l.sessionVersion) || 0 }, SECRET)}` }, `/api/supplier-portal${url}`);

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 400) problems.push(line); differences++; };
const compare = async (label: string, send: Ask) => {
  checked++;
  const [m, p] = [await send('mongo'), await send('postgres')];
  if (m.status !== p.status) return note(`${label}: status ${m.status} vs ${p.status}`);
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 50)) note(`${label}: ${describeDifference(d)}`);
};

await compare('suppliers tab', staff('/suppliers'));
for (const status of ['open', 'closed', 'cancelled', 'all']) await compare(`POs ${status}`, staff(`/pos?status=${status}`));
for (const po of pos) await compare(`PO ${po.poNumber}`, staff(`/pos/${po._id}`));
for (const queue of ['review', 'final']) await compare(`queue ${queue}`, staff(`/blocks?queue=${queue}`));
for (const b of blocks.filter(x => x.sentAt)) await compare(`block ${b.poNumber}/${b.blockNumber || b._id}`, staff(`/blocks/${b._id}`));
await compare('Incoming material', ask({ 'x-test-user': JSON.stringify({ id: 'compare-sales', permissions: ['view_incoming_material'] }) }, '/api/suppliers/incoming'));
for (const l of logins) {
  await compare(`portal ${l.email}: me`, asLogin(l, '/me'));
  await compare(`portal ${l.email}: POs`, asLogin(l, '/pos'));
  for (const po of pos.filter(p => String(p.supplierId) === String(l.supplierId))) await compare(`portal ${l.email}: PO ${po.poNumber}`, asLogin(l, `/pos/${po._id}`));
  for (const b of blocks.filter(x => String(x.supplierId) === String(l.supplierId))) await compare(`portal ${l.email}: block ${b.blockNumber || b._id}`, asLogin(l, `/blocks/${b._id}`));
}

console.log(`\n${checked} requests compared, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
