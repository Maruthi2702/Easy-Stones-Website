/**
 * Copy the customer area from MongoDB into Postgres, or check a copy.
 * Only READS MongoDB (secondary preferred); writes only to DATABASE_URL.
 * See src/db/README.md.
 *
 *   node scripts/pg-copy-customers.ts                 dry run: map and report, write nothing
 *   node scripts/pg-copy-customers.ts --write         replace the copied tables in one transaction
 *   node scripts/pg-copy-customers.ts --verify        compare Postgres with MongoDB row by row
 *   node scripts/pg-copy-customers.ts --lock "name"   at cutover: refuse every copy from now on
 *   --report <file>   write the full report (every problem, by id) as JSON
 *
 * MONGO_URI is the source, DATABASE_URL the target (postgres://…?sslmode=require
 * for RDS, or pglite:<folder> for a local try-out).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { openDb, migrateDb } from '../src/db/client.ts';
import { copyCustomerArea, verifyCustomerArea, lockCopies, type CustomerAreaSource } from '../src/db/copy/customerArea.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const mongoUri = process.env.MONGO_URI;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL is not set.'); process.exit(1); }

async function readMongo(uri: string): Promise<CustomerAreaSource> {
  const client = new MongoClient(uri, { readPreference: 'secondaryPreferred', appName: 'pg-copy-customers' });
  await client.connect();
  try {
    const db = client.db();
    const all = (name: string) => db.collection(name).find({}).toArray();
    const [locations, roles, users, visitTypes, resourceFamilies, resourceTypes, customers, schedules, activityLogs, customerDeleteBackups, customerMergeBackups] =
      await Promise.all(['locations', 'roles', 'users', 'visittypes', 'resourcefamilies', 'resourcetypes', 'customers', 'schedules', 'activitylogs', 'customerdeletebackups', 'customermergebackups'].map(all));
    return { locations, roles, users, visitTypes, resourceFamilies, resourceTypes, customers, schedules, activityLogs, customerDeleteBackups, customerMergeBackups };
  } finally {
    await client.close();
  }
}

const { db, close } = await openDb(databaseUrl);
try {
  await migrateDb(db, databaseUrl);
  if (flag('--lock')) {
    const by = valueOf('--lock');
    if (!by) throw new Error('--lock needs a name: who is locking it.');
    await lockCopies(db, by);
    console.log('Locked: this database will refuse every copy from MongoDB from now on.');
  } else {
    if (!mongoUri) throw new Error('MONGO_URI is not set.');
    const started = Date.now();
    const src = await readMongo(mongoUri);
    if (flag('--verify')) {
      const diffs = await verifyCustomerArea(db, src);
      console.log(diffs.length ? diffs.join('\n') : 'Verified: Postgres matches MongoDB, every table, every row, every column.');
      process.exitCode = diffs.length ? 1 : 0;
    } else {
      const write = flag('--write');
      const report = await copyCustomerArea(db, src, { write });
      console.log(write ? 'Copied.' : 'Dry run — nothing written.');
      console.log('\nMongoDB records read:'); console.table(report.source);
      console.log('Postgres rows:'); console.table(report.tables);
      console.log(`Problems (${report.problems.length}), by kind:`);
      for (const [k, n] of Object.entries(report.summary)) console.log(`  ${String(n).padStart(5)}  ${k}`);
      const out = valueOf('--report');
      if (out) { fs.writeFileSync(out, JSON.stringify(report, null, 1)); console.log(`\nFull report: ${out}`); }
      console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  }
} finally {
  await close();
}
