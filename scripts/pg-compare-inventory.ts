/**
 * Do Inventory, in-transit and Purchasing answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-inventory.ts
 *
 * Reads MongoDB only (MONGO_URI). Postgres is PGlite in memory (never RDS). Through the real routers, each
 * request is asked of MongoDB then of Postgres (`DB_INVENTORY`) and compared record by record: the stock summary
 * (with and without cost data), filter values, the item list under several filters, the grouped list, velocity
 * (all locations and each one), in-transit containers, and Purchasing's revision, metadata, and — for every scope —
 * its plan, incoming supply and draft list, as an admin and as a login at each branch. Nothing is written.
 * Sums are exact on Postgres and floats on MongoDB, so numbers that agree to 8 significant digits count as the same.
 * Purchasing reads in a MongoDB snapshot transaction, which needs the primary (reads only; nothing is written).
 * A request that answers an error on both sides is reported, never counted as the same. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import createInventoryAnalysisRouter from '../src/routes/inventoryAnalysis.ts';
import createPurchasingRouter from '../src/purchasing/router.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-inventory');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'primary', appName: 'pg-compare-inventory', autoIndex: false, autoCreate: false });

const items: Loose[] = source.inventoryItems;
const scopes: Loose[] = source.purchasingScopes;
const branches = [...new Set(source.locations.map((l: Loose) => String(l.name ?? '')))].filter(Boolean).sort();
const first = (key: string) => String(items.find(i => i[key])?.[key] ?? '');
console.log(`${items.length} stock items, ${source.inventoryTransitShipments.length} containers, ${scopes.length} purchasing scopes, branches: ${branches.join(', ')}.`);

const authenticate = (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); };
const requirePermission = (name: string) => (req: Loose, res: Loose, next: () => void) =>
  (req.user?.permissions || []).includes(name) ? next() : res.status(403).json({ message: 'No access' });
const app = express();
app.use(express.json());
app.use('/api/inventory-analysis', createInventoryAnalysisRouter({ authenticate, requirePermission, uploadMemory: { single: () => (_q: unknown, _r: unknown, next: () => void) => next() } } as never));
app.use('/api/purchasing', createPurchasingRouter({ authenticate }));

const PERMS = ['view_inventory_analysis', 'view_purchasing'];
const ADMIN = { id: 'compare-admin', username: 'admin', displayName: 'Admin', permissions: [...PERMS, 'view_inventory_prices'], assignedLocations: ['*'] };
const NO_PRICES = { ...ADMIN, username: 'no-prices', permissions: PERMS };
const atBranch = (b: string) => ({ ...NO_PRICES, id: `compare-${b}`, username: `at-${b}`, assignedLocations: [b] });

const ask = (user: Loose, url: string) => async (database: 'mongo' | 'postgres') => {
  process.env.DB_INVENTORY = database === 'postgres' ? 'postgres' : '';
  const r = await request(app).get(url).set('x-test-user', JSON.stringify(user));
  return { status: r.status, body: r.body };
};

const close = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number'
  && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
let checked = 0, differences = 0, rounded = 0, known = 0;
const bothFailed: string[] = [];
const problems: string[] = [];
/**
 * Slabs with the same received date have no defined order in MongoDB (its natural order), so a page of the
 * list can cut a tie differently. The list is compared as a set by id when the whole answer fits one page,
 * and by its totals when it doesn't.
 */
const settled = (label: string, body: Loose) => {
  // Velocity is ordered by days of supply, and rows with none (or the same) come in an order MongoDB doesn't define.
  if (Array.isArray(body?.rows)) return { ...body, rows: [...body.rows].sort((a: Loose, b: Loose) => `${a.product}::${a.location}`.localeCompare(`${b.product}::${b.location}`)) };
  if (!/(^| )items( |$)/.test(label) || !Array.isArray(body?.items)) return body;
  const whole = body.total <= body.items.length;
  return whole ? { ...body, items: [...body.items].sort((a: Loose, b: Loose) => String(a._id).localeCompare(String(b._id))) } : { total: body.total, totalPages: body.totalPages, page: body.page };
};
const compare = async (label: string, send: ReturnType<typeof ask>) => {
  checked++;
  const [m, p] = [await send('mongo'), await send('postgres')];
  if (m.status >= 400 && m.status === p.status) bothFailed.push(`${label}: ${m.status}`);
  m.body = settled(label, m.body); p.body = settled(label, p.body);
  if (m.status !== p.status) { problems.push(`${label}: status ${m.status} vs ${p.status}`); differences++; return; }
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 100)) {
    if (close(d.mongo, d.postgres)) { rounded++; continue; }
    // Understood and harmless (DB_MOVE_CHECKLIST.md): clocks, a legacy shipment with no `active` field, and the plan's
    // fingerprint, which hashes the scope's JSON in MongoDB's key order (a Postgres row has none).
    if (/(^| )plan$/.test(label) && /^(generatedAt|validUntil)$/.test(d.path)) { known++; continue; }
    if (/(^| )plan$/.test(label) && d.path === 'fingerprint') { known++; continue; }
    if (label === 'in-transit' && /\.active$/.test(d.path) && d.mongo === undefined && d.postgres === true) { known++; continue; }
    if (problems.length < 400) problems.push(`${label}: ${describeDifference(d)}`);
    differences++;
  }
};

const q = (o: Record<string, string>) => `?${new URLSearchParams(o)}`;
const category = first('category'), location = first('location'), product = first('product');
const search = product.split(' ')[0];
const stockViews: [string, string][] = [
  ['', ''], ['category', q({ category })], ['location', q({ location })], ['product', q({ product })],
  ['search', q({ search })], ['available', q({ status: 'available' })], ['combined', q({ category, location })]
];
for (const user of [ADMIN, NO_PRICES]) {
  for (const [name, qs] of stockViews) await compare(`${user.username} summary ${name}`, ask(user, `/api/inventory-analysis/summary${qs}`));
  await compare(`${user.username} items`, ask(user, `/api/inventory-analysis/items${q({ page: '1', limit: '50' })}`));
}
await compare('filters', ask(ADMIN, '/api/inventory-analysis/filters'));
for (const [name, qs] of stockViews) {
  const withPaging = (qs ? `${qs}&` : '?') + 'page=1&limit=50';
  await compare(`items ${name}`, ask(ADMIN, `/api/inventory-analysis/items${withPaging}`));
  await compare(`items grouped ${name}`, ask(ADMIN, `/api/inventory-analysis/items/grouped${(qs ? `${qs}&` : '?') + 'page=1&limit=20'}`));
}
await compare('items page 2', ask(ADMIN, `/api/inventory-analysis/items${q({ page: '2', limit: '50' })}`));
await compare('grouped page 2', ask(ADMIN, `/api/inventory-analysis/items/grouped${q({ page: '2', limit: '20' })}`));
await compare('velocity', ask(ADMIN, '/api/inventory-analysis/velocity'));
for (const loc of [...new Set(items.map(i => String(i.location ?? '')))].filter(Boolean).sort()) await compare(`velocity ${loc}`, ask(ADMIN, `/api/inventory-analysis/velocity${q({ location: loc })}`));
await compare('in-transit', ask(ADMIN, '/api/inventory-analysis/in-transit'));

for (const user of [ADMIN, ...branches.map(atBranch)]) {
  await compare(`${user.username} revision`, ask(user, '/api/purchasing/revision'));
  await compare(`${user.username} metadata`, ask(user, '/api/purchasing/metadata'));
  for (const s of scopes) {
    const id = String(s._id);
    await compare(`${user.username} scope ${s.name} plan`, ask(user, `/api/purchasing/scopes/${id}/plan`));
    await compare(`${user.username} scope ${s.name} incoming`, ask(user, `/api/purchasing/scopes/${id}/inbound`));
    await compare(`${user.username} scope ${s.name} drafts`, ask(user, `/api/purchasing/scopes/${id}/drafts`));
    await compare(`${user.username} scope ${s.name} drafts paged`, ask(user, `/api/purchasing/scopes/${id}/drafts?paginated=true&limit=20`));
  }
}

console.log(`\n${bothFailed.length} request(s) answered an error (same status) on both sides${bothFailed.length ? `: ${bothFailed.slice(0, 8).join(' | ')}` : ''}.`);
console.log(`${checked} requests compared, ${differences} differences (${rounded} number(s) agreed to 8 digits only; ${known} understood difference(s) set aside: plan clocks and fingerprint, in-transit active field).`);
const byLabel = new Map<string, number>();
for (const l of problems) { const k = l.split(': ')[0]; byLabel.set(k, (byLabel.get(k) ?? 0) + 1); }
for (const [l, n] of byLabel) console.log(` * ${l}: ${n}`);
const pick = (re: RegExp, n: number) => problems.filter(l => re.test(l)).slice(0, n);
for (const line of [...pick(/^in-transit/, 6), ...pick(/^admin scope/, 6), ...pick(/^at-Atlanta/, 8)]) console.log(' -', line.slice(0, 300));
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
