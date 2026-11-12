/**
 * The way back: copy the customer area from Postgres into MongoDB (src/db/reverse/README.md).
 *
 *   DATABASE_URL=… MONGO_URI=… node scripts/pg-reverse.ts                      dry run: build, report, write nothing
 *   … node scripts/pg-reverse.ts --apply --confirm <mongo database name>      replace the customer collections
 *   --out <folder>   also save the documents as JSON, one file per collection
 *
 * Reads Postgres only. Replaces exactly these MongoDB collections (and no others):
 * customers, schedules, activitylogs, customerdeletebackups, customermergebackups,
 * importmemories, spsimportruns, spsimportitems. Each is built beside the real one,
 * given its indexes and counted before it is swapped in, so a failure leaves MongoDB as it was.
 * Run it with customer writes paused, the same way the forward copy is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { openDb } from '../src/db/client.ts';
import { readPostgres } from '../src/db/reverse/readPostgres.ts';
import { reverseDocs, REVERSE_COLLECTIONS } from '../src/db/reverse/docs.ts';
import { writeMongo } from '../src/db/reverse/writeMongo.ts';

const args = process.argv.slice(2);
const valueOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const url = process.env.DATABASE_URL, mongoUri = process.env.MONGO_URI;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const pg = await openDb(url);
try {
  const docs = reverseDocs(await readPostgres(pg.db));
  console.log('Built from Postgres:');
  for (const name of REVERSE_COLLECTIONS) console.log(`  ${name.padEnd(24)} ${docs[name].length}`);
  const out = valueOf('--out');
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const name of REVERSE_COLLECTIONS) fs.writeFileSync(path.join(out, `${name}.json`), EJSON.stringify(docs[name], { relaxed: true }, 1));
    console.log('Saved to', out);
  }
  if (!args.includes('--apply')) { console.log('Dry run: MongoDB untouched. Add --apply --confirm <database> to write.'); process.exit(0); }
  if (!mongoUri) { console.error('MONGO_URI is not set.'); process.exit(1); }
  const probe = new MongoClient(mongoUri); await probe.connect();
  const dbName = probe.db().databaseName; await probe.close();
  if (valueOf('--confirm') !== dbName) { console.error(`--confirm must name the MongoDB database being replaced: "${dbName}".`); process.exit(1); }
  for (const r of await writeMongo(mongoUri, docs)) console.log(`  ${r.collection.padEnd(24)} ${r.before} → ${r.after} (${r.indexes} indexes kept)`);
  console.log('Done.');
} finally {
  await pg.close();
}
