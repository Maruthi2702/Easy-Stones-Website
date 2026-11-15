/**
 * Does the side nav order answer the same from Postgres as from MongoDB, on real data?
 *
 *   node --env-file=.env scripts/pg-compare-settings.ts
 *
 * Reads MongoDB only (MONGO_URI), never writes it. Postgres is PGlite in memory (never RDS).
 * GET /api/nav-order through the real router for each login kind, and every app setting key
 * read through the layer. Also checks the copy's own table rows (`--scope settings` check) are
 * equal. Exit 0 = the same.
 */
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyFromMongo, verifyArea } from '../src/db/copy/plan.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { normalize, diffEntries, describeDifference } from '../src/db/customers/parity.ts';
import { readSetting } from '../src/db/settings/index.ts';
import createNavOrderRouter from '../src/routes/navOrder.ts';
import type { Loose } from '../src/types/records.ts';

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }

const pg = await openDb('pglite:memory');
await migrateDb(pg.db, 'pglite:memory');
console.log('Reading MongoDB and copying into memory …');
const source = await readMongo(mongoUri, 'pg-compare-settings');
const report = await copyFromMongo(pg.db, source, { write: true });
console.log(`Copied ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows (${report.problems.length} problems reported by the copy).`);
useAppDbForTests(pg.db);
await mongoose.connect(mongoUri, { readPreference: 'secondaryPreferred', appName: 'pg-compare-settings', autoIndex: false, autoCreate: false });

const settings: Loose[] = source.appSettings;
console.log(`${settings.length} app settings (${settings.map(s => s.key).join(', ') || 'none'}), ${source.cloudinaryToS3Backups.length} file-move backups, ${source.legacyLeads.length} legacy leads, ${source.legacySalesCustomers.length} legacy customers.`);

const app = express();
app.use(express.json());
const noop = () => (_req: Loose, _res: Loose, next: () => void) => next();
app.use('/api/nav-order', createNavOrderRouter({
  authenticate: (req: Loose, _res: Loose, next: () => void) => { req.user = JSON.parse(req.headers['x-test-user'] || '{}'); next(); },
  requirePermission: noop, requireAction: noop
}));

let checked = 0, differences = 0;
const problems: string[] = [];
const note = (line: string) => { if (problems.length < 100) problems.push(line); differences++; };
const on = (database: 'mongo' | 'postgres') => { process.env.DB_SETTINGS = database === 'postgres' ? 'postgres' : ''; };

for (const who of ['admin', 'staff']) {
  checked++;
  const asked = async (database: 'mongo' | 'postgres') => {
    on(database);
    const r = await request(app).get('/api/nav-order').set('x-test-user', JSON.stringify({ id: who, username: who, permissions: [] }));
    return { status: r.status, body: r.body };
  };
  const [m, p] = [await asked('mongo'), await asked('postgres')];
  if (m.status !== p.status) { note(`nav order (${who}): status ${m.status} vs ${p.status}`); continue; }
  for (const d of diffEntries(normalize(m.body), normalize(p.body), 50)) note(`nav order (${who}): ${describeDifference(d)}`);
}
for (const s of settings) {
  checked++;
  on('mongo'); const m = await readSetting(String(s.key));
  on('postgres'); const p = await readSetting(String(s.key));
  for (const d of diffEntries(normalize({ v: m }), normalize({ v: p }), 50)) note(`setting ${s.key}: ${describeDifference(d)}`);
}
checked++;
const rowDiffs = await verifyArea(pg.db, source, 'settings');
for (const d of rowDiffs) note(`rows: ${d}`);

console.log(`\n${checked} checks, ${differences} differences.`);
for (const line of problems.slice(0, 60)) console.log(' -', line);
await mongoose.disconnect();
await pg.close();
process.exit(differences ? 1 : 0);
