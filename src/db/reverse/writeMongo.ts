/**
 * Put the reversed documents into MongoDB without ever leaving a collection half-written:
 * each one is built beside the real one (`<name>__reverse`), given the real one's indexes
 * (so the unique ones are checked on the way in), counted, and only then renamed over it.
 */
import { MongoClient } from 'mongodb';
import type { Loose } from '../../types/records.ts';
import { REVERSE_COLLECTIONS, type ReverseDocs } from './docs.ts';

const CHUNK = 500;
export interface ReverseWriteReport { collection: string; before: number; after: number; indexes: number }

export async function writeMongo(uri: string, docs: ReverseDocs, appName = 'pg-reverse'): Promise<ReverseWriteReport[]> {
  const client = new MongoClient(uri, { appName });
  await client.connect();
  try {
    const db = client.db();
    const staged: string[] = [];
    const report: ReverseWriteReport[] = [];
    const exists = async (name: string) => (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
    // Stage everything first: if any collection fails (a duplicate email, say) nothing real has been touched.
    try {
      for (const name of REVERSE_COLLECTIONS) {
        const stage = `${name}__reverse`;
        await db.collection(stage).drop().catch(() => {});
        await db.createCollection(stage);
        staged.push(stage);
        const list = docs[name] as Loose[];
        for (let i = 0; i < list.length; i += CHUNK) await db.collection(stage).insertMany(list.slice(i, i + CHUNK), { ordered: true });
        let indexes = 0;
        const had = await exists(name);
        if (had) {
          for (const ix of await db.collection(name).indexes()) {
            if (ix.name === '_id_') continue;
            const { key, name: ixName, v: _v, ns: _ns, ...options } = ix as Loose;
            await db.collection(stage).createIndex(key, { name: ixName, ...options });
            indexes++;
          }
        }
        const count = await db.collection(stage).countDocuments();
        if (count !== list.length) throw new Error(`${name}: wrote ${count} of ${list.length}`);
        report.push({ collection: name, before: had ? await db.collection(name).estimatedDocumentCount() : 0, after: count, indexes });
      }
    } catch (err) {
      for (const stage of staged) await db.collection(stage).drop().catch(() => {});
      throw err;
    }
    for (const name of REVERSE_COLLECTIONS) await db.collection(`${name}__reverse`).rename(name, { dropTarget: true });
    return report;
  } finally {
    await client.close();
  }
}
