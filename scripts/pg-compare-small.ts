/**
 * Do the small ones answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-small.ts
 *
 * Reads MongoDB only (MONGO_URI), never writes it. Postgres is PGlite in memory (never RDS). Every read the screens make —
 * the product list (public, admin names, each product's detail), the colour list, the Crossover Sheet, the sales resources,
 * Team Files (every folder, every item) — through the data layers on each database; then the copy's own row check for the
 * `small` scope. Intended differences: a product colour's id (Postgres keeps colours by position). Exit 0 = the same.
 */
import mongoose from 'mongoose';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo, verifyArea } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import * as small from '../src/db/small/index.ts';
import * as teamFiles from '../src/db/teamFiles/index.ts';
import '../src/models/User.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-small');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-small', autoIndex: false, autoCreate: false });
console.log(`${source.products.length} products, ${source.easyStonesColors.length} colours, ${source.crossoverColors.length} crossover colours, ${source.contactSubmissions.length} contact messages, ${source.teamFiles.length} Team Files items, ${source.salesResources.length} sales resources.`);

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 100) problems.push(line); differences++; };
const on = (database: 'mongo' | 'postgres') => { process.env.DB_SMALL = database === 'postgres' ? 'postgres' : ''; };
/** Colours inside a product have no ids on Postgres: take them out of both sides. */
const noColorIds = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'colors' && Array.isArray(x) ? x.map(({ _id, id, ...c }: Loose) => c) : x)));
// Reads that order equal keys arbitrarily are compared as sets.
const bySet = (v: unknown) => (Array.isArray(v) ? [...v].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) : v);

async function compare(label: string, read: () => Promise<unknown>, tidy: (v: unknown) => unknown = v => v) {
  checked++;
  const ask = async (db: 'mongo' | 'postgres') => { on(db); try { return JSON.parse(JSON.stringify(await read() ?? null)); } catch (e) { return { error: String((e as Error).message).slice(0, 80) }; } };
  const [m, p] = [await ask('mongo'), await ask('postgres')];
  for (const d of diffEntries(normalize(tidy(m)), normalize(tidy(p)), 50)) note(`${label}: ${describeDifference(d)}`);
}

await compare('products (public list)', () => small.listProducts(), noColorIds);
await compare('products (admin names)', () => small.listProductNames());
for (const p of source.products) await compare(`product ${p.id}`, () => small.getProduct(Number(p.id)), noColorIds);
await compare('colours', () => small.listColors());
await compare('crossover sheet', () => small.listCrossovers());
await compare('sales resources', () => small.listSalesResources(), bySet);

const folderIds: (string | null)[] = [null, ...source.teamFiles.filter((f: Loose) => f.isFolder).map((f: Loose) => String(f._id))];
for (const folder of folderIds) await compare(`team files in ${folder ?? 'the top'}`, () => teamFiles.listResources(folder), bySet);
for (const f of source.teamFiles) await compare(`team file ${f._id}`, () => teamFiles.getResource(String(f._id)));

checked++;
for (const d of await verifyArea(pg.db, source, 'small')) note(`rows: ${d}`);

console.log(`\n${checked} checks, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
