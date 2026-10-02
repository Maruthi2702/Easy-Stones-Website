/**
 * Copy the whole database from the current cluster to a new one.
 *
 *   node scripts/copy-database.js           # dry run: what would be copied, and whether the target is empty
 *   node scripts/copy-database.js --apply   # copy every collection + its indexes, then verify counts
 *
 * Written for moving off the free Atlas cluster in Mumbai (AWS ap-south-1) to
 * one in N. Virginia (us-east-1), next to the Render server: a free (M0)
 * cluster can't change region, so the move is a new cluster plus a copy.
 * Every database call was paying a ~280ms round trip to Mumbai.
 *
 * Source: MONGO_URI. Target: TARGET_MONGO_URI (add it to .env; neither is
 * ever printed). The target database gets the same name as the source's
 * ("easy-stones"), whatever path the target URI carries, so the app finds its
 * data once MONGO_URI is switched over.
 *
 * Refuses to --apply into a target collection that already has documents, so
 * it can't double up a copy or overwrite anything; documents keep their _id.
 * Read-only on the source.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const apply = process.argv.includes('--apply');
const BATCH = 500;

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in .env');
  if (!process.env.TARGET_MONGO_URI) throw new Error('TARGET_MONGO_URI is not set in .env — add the new cluster\'s connection string there first.');
  if (process.env.TARGET_MONGO_URI === process.env.MONGO_URI) throw new Error('TARGET_MONGO_URI is the same as MONGO_URI — nothing to copy.');

  const source = await mongoose.createConnection(process.env.MONGO_URI).asPromise();
  const dbName = source.db.databaseName;
  const targetConn = await mongoose.createConnection(process.env.TARGET_MONGO_URI).asPromise();
  const target = targetConn.client.db(dbName);

  const sourceHello = await source.db.admin().command({ hello: 1 });
  const targetHello = await targetConn.db.admin().command({ hello: 1 });
  console.log(`source: database "${dbName}", region ${sourceHello.tags?.region || 'unknown'}`);
  console.log(`target: database "${dbName}", region ${targetHello.tags?.region || 'unknown'}\n`);

  const collections = (await source.db.listCollections({}, { nameOnly: false }).toArray())
    .filter((c) => c.type !== 'view' && !c.name.startsWith('system.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const plan = [];
  for (const c of collections) {
    const count = await source.db.collection(c.name).estimatedDocumentCount();
    const indexes = (await source.db.collection(c.name).indexes()).filter((i) => i.name !== '_id_');
    const targetCount = await target.collection(c.name).countDocuments({}, { limit: 1 });
    plan.push({ name: c.name, count, indexes, targetHasDocs: targetCount > 0 });
    console.log(`  ${c.name.padEnd(28)} ${String(count).padStart(6)} docs, ${indexes.length} indexes${targetCount ? '   ⚠ target already has documents' : ''}`);
  }

  const blocked = plan.filter((p) => p.targetHasDocs);
  if (!apply) {
    console.log(`\n${plan.length} collections, ${plan.reduce((n, p) => n + p.count, 0)} documents.`);
    console.log(blocked.length
      ? `\n${blocked.length} target collection(s) already have documents — --apply would refuse. Use an empty cluster.`
      : '\nTarget is empty. Dry run — nothing written. Re-run with --apply to copy.');
    await Promise.all([source.close(), targetConn.close()]);
    return;
  }
  if (blocked.length) {
    throw new Error(`Target already has documents in: ${blocked.map((p) => p.name).join(', ')} — nothing copied.`);
  }

  console.log('\nCopying...');
  for (const p of plan) {
    const from = source.db.collection(p.name);
    const to = target.collection(p.name);
    let batch = [];
    let copied = 0;
    for await (const doc of from.find({}, { batchSize: BATCH })) {
      batch.push(doc);
      if (batch.length === BATCH) {
        await to.insertMany(batch, { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await to.insertMany(batch, { ordered: false });
      copied += batch.length;
    }
    if (!copied) await target.createCollection(p.name).catch(() => {});
    for (const idx of p.indexes) {
      const { key, name, v, ns, background, ...options } = idx;
      await to.createIndex(key, { name, ...options });
    }
    console.log(`  ${p.name.padEnd(28)} ${String(copied).padStart(6)} docs, ${p.indexes.length} indexes`);
  }

  console.log('\nVerifying...');
  let ok = true;
  for (const p of plan) {
    const [a, b] = await Promise.all([
      source.db.collection(p.name).countDocuments(),
      target.collection(p.name).countDocuments()
    ]);
    if (a !== b) ok = false;
    if (a !== b) console.log(`  ${p.name}: source ${a}, target ${b}  ✗ MISMATCH (a write may have landed during the copy)`);
  }
  console.log(ok
    ? '  All collections match. Next: set MONGO_URI to the new cluster in Render and .env, then restart.'
    : '\nSome counts differ — check the lines above before switching MONGO_URI.');

  await Promise.all([source.close(), targetConn.close()]);
};

main().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
