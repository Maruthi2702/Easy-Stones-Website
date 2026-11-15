/**
 * How long does one stock import take on Postgres, with the real catalog's size and shape?
 *
 *   node --env-file=.env scripts/pg-time-stock-import.ts postgres:///es_import [rows=11000]
 *
 * Reads MongoDB only (the live items, as the rows to import; repeated under new serial numbers up to `rows`).
 * Writes ONLY to the scratch Postgres in the argument (migrated here, its inventory tables emptied first):
 * never point it at RDS or anything you keep. Imports twice: the first into an empty table, the second over the
 * first (the realistic one: it backs the whole previous catalog up, deletes it, inserts the new one).
 */
import { sql } from 'drizzle-orm';
import { openDb, migrateDb } from '../src/db/client.ts';
import { readMongo } from '../src/db/copy/readMongo.ts';
import { useAppDbForTests } from '../src/db/appDb.ts';
import { importInventoryStock } from '../src/db/inventory/index.ts';
import type { Loose } from '../src/types/records.ts';

const [url, rowsArg] = process.argv.slice(2);
const mongoUri = process.env.MONGO_URI;
if (!url || !/^postgres(ql)?:\/\/\/?[a-z_0-9]*$|^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)/i.test(url)) { console.error('Give a LOCAL scratch Postgres URL, e.g. postgres:///es_import'); process.exit(1); }
if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
const want = Number(rowsArg || 11000);

const live: Loose[] = (await readMongo(mongoUri, 'pg-time-stock-import')).inventoryItems;
if (!live.length) { console.error('No stock in MongoDB to copy the shape from.'); process.exit(1); }
const rows: Loose[] = [];
for (let i = 0; rows.length < want; i += 1) {
  const { _id, importedAt, importedByName, importedById, createdAt, updatedAt, __v, ...rest } = live[i % live.length];
  rows.push(i < live.length ? rest : { ...rest, serialNumber: `${rest.serialNumber}-copy${Math.floor(i / live.length)}`, barcodeId: `${rest.barcodeId}-c${Math.floor(i / live.length)}` });
}
console.log(`${live.length} live items; importing ${rows.length} rows.`);

const pg = await openDb(url, { max: 4 });
await migrateDb(pg.db, url);
await pg.db.execute(sql`truncate inventory_items, inventory_stock_imports, inventory_stock_backups, inventory_stock_state, inventory_revision cascade`);
useAppDbForTests(pg.db);
process.env.DB_INVENTORY = 'postgres';

for (const label of ['first import (empty table)', 'second import (replaces the first, backs it up)']) {
  const t0 = performance.now();
  const result = await importInventoryStock({ rows, sourceFilename: 'timing.xlsx', sourceHash: label, importedByName: 'Timing', importedById: null }) as Loose;
  console.log(`${label}: ${((performance.now() - t0) / 1000).toFixed(2)} s`, JSON.stringify(result).slice(0, 200));
}
const [{ n }] = (await pg.db.execute(sql`select count(*)::int as n from inventory_items`)).rows as { n: number }[];
const [{ b }] = (await pg.db.execute(sql`select count(*)::int as b from inventory_stock_backups`)).rows as { b: number }[];
console.log(`${n} items in the table; ${b} backup chunk(s).`);
await pg.close();
