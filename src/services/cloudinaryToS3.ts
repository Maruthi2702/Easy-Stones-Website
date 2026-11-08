/**
 * Moving stored files from Cloudinary to S3 (2026-11): the engine behind
 * scripts/migrate-cloudinary-to-s3.ts, kept here so it is tested against an
 * in-memory MongoDB (cloudinaryToS3.test.ts).
 *
 *   1. scan     every collection, every field, for this account's Cloudinary URLs
 *   2. copy     each file to S3 under the same folder/name (skips ones already there)
 *   3. rewrite  each field that holds a copied URL, to the CDN URL — the old value
 *               saved first in `cloudinarytos3backups`, the write conditional on the
 *               field not having changed since it was read (a live edit wins; rerun later)
 *   4. undo     puts a run's backed-up values back
 *
 * A URL whose file could not be copied is left as it is, so nothing points at a
 * file that isn't there. Cloudinary itself is never changed.
 */
import type mongoose from 'mongoose';
import { cdnUrlFor, findCloudinaryUrls, parseCloudinaryUrl, s3KeyForCloudinary } from '../utils/fileStoreRules.ts';

type Db = NonNullable<typeof mongoose.connection.db>;
type Doc = Record<string, unknown> & { _id: unknown };

export const BACKUP_COLLECTION = 'cloudinarytos3backups';

export interface ScanHit {
  collection: string;
  _id: unknown;
  /** Top-level fields that hold at least one URL. */
  fields: string[];
}

export interface ScanResult {
  hits: ScanHit[];
  /** Cloudinary URL → S3 key. */
  urls: Map<string, string>;
  /** Per collection: documents and fields holding URLs. */
  byCollection: Record<string, { documents: number; fields: Record<string, number> }>;
  /** URLs seen but not understood (left alone). */
  unparsed: string[];
}

export async function scanForCloudinary(
  db: Db,
  { cloudName, collections }: { cloudName: string; collections?: string[] },
): Promise<ScanResult> {
  const result: ScanResult = { hits: [], urls: new Map(), byCollection: {}, unparsed: [] };
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && n !== BACKUP_COLLECTION && (!collections?.length || collections.includes(n)))
    .sort();

  for (const name of names) {
    for await (const doc of db.collection(name).find({}, { batchSize: 200 })) {
      const fields: string[] = [];
      for (const [field, value] of Object.entries(doc)) {
        if (field === '_id' || value == null) continue;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (!text || !text.includes('res.cloudinary.com/')) continue;
        const found = findCloudinaryUrls(text, cloudName);
        if (!found.length) continue;
        fields.push(field);
        for (const url of found) {
          const asset = parseCloudinaryUrl(url);
          if (asset) result.urls.set(url, s3KeyForCloudinary(asset));
          else if (!result.unparsed.includes(url)) result.unparsed.push(url);
        }
      }
      if (fields.length) {
        result.hits.push({ collection: name, _id: doc._id, fields });
        const stats = (result.byCollection[name] ??= { documents: 0, fields: {} });
        stats.documents++;
        for (const f of fields) stats.fields[f] = (stats.fields[f] ?? 0) + 1;
      }
    }
  }
  return result;
}

export interface FileCopier {
  /** Already in S3? (makes reruns cheap) */
  exists(key: string): Promise<boolean>;
  /** Download from Cloudinary, upload to S3. Throws with a reason on failure. */
  copy(url: string, key: string): Promise<{ bytes: number }>;
}

export interface CopyResult {
  copied: string[];
  alreadyThere: string[];
  failed: { url: string; key: string; error: string }[];
  bytes: number;
}

/** Copy every file once (URLs that differ only by version share a key). */
export async function copyFiles(
  urls: Map<string, string>,
  copier: FileCopier,
  { concurrency = 6, onProgress }: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<CopyResult> {
  const byKey = new Map<string, string>();
  for (const [url, key] of urls) if (!byKey.has(key)) byKey.set(key, url);
  const jobs = [...byKey.entries()];
  const result: CopyResult = { copied: [], alreadyThere: [], failed: [], bytes: 0 };
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < jobs.length) {
      const [key, url] = jobs[next++];
      try {
        if (await copier.exists(key)) result.alreadyThere.push(key);
        else {
          const { bytes } = await copier.copy(url, key);
          result.copied.push(key);
          result.bytes += bytes;
        }
      } catch (err) {
        result.failed.push({ url, key, error: (err as Error).message });
      }
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return result;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Replace mapped URLs anywhere inside a value (strings, arrays, plain objects).
 * ObjectIds, Dates, Buffers and other BSON values are left exactly as they are.
 */
export function rewriteValue(value: unknown, map: (url: string) => string | undefined, cloudName: string): { value: unknown; changed: number } {
  let changed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!v.includes('res.cloudinary.com/')) return v;
      let out = v;
      for (const url of findCloudinaryUrls(v, cloudName).sort((a, b) => b.length - a.length)) {
        const to = map(url);
        if (to && out.includes(url)) {
          out = out.split(url).join(to);
          changed++;
        }
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), changed };
}

export interface RewriteResult {
  documents: number;
  urlsReplaced: number;
  /** Changed by someone between the read and the write: left alone, rerun to pick up. */
  conflicts: { collection: string; _id: unknown }[];
}

export async function rewriteUrls(
  db: Db,
  hits: ScanHit[],
  {
    cloudName,
    cdnBase,
    urls,
    copiedKeys,
    runId,
    beforeWrite,
  }: {
    cloudName: string;
    cdnBase: string;
    urls: Map<string, string>;
    copiedKeys: Set<string>;
    runId: string;
    /** Tests only: runs between reading a record and writing it. */
    beforeWrite?: (hit: ScanHit) => Promise<void>;
  },
): Promise<RewriteResult> {
  const map = (url: string) => {
    const key = urls.get(url);
    return key && copiedKeys.has(key) ? cdnUrlFor(cdnBase, key) : undefined;
  };
  const backups = db.collection(BACKUP_COLLECTION);
  const result: RewriteResult = { documents: 0, urlsReplaced: 0, conflicts: [] };

  for (const hit of hits) {
    const collection = db.collection<Doc>(hit.collection);
    const doc = await collection.findOne({ _id: hit._id } as never);
    if (!doc) continue;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let replaced = 0;
    for (const field of hit.fields) {
      const { value, changed } = rewriteValue(doc[field], map, cloudName);
      if (changed) {
        before[field] = doc[field];
        after[field] = value;
        replaced += changed;
      }
    }
    if (!replaced) continue;

    await beforeWrite?.(hit);
    const backup = await backups.insertOne({ runId, collection: hit.collection, docId: hit._id, fields: before, at: new Date() });
    // Only if every field still holds what was read: a live edit in between wins.
    const write = await collection.updateOne({ _id: hit._id, ...before } as never, { $set: after });
    if (write.matchedCount === 0) {
      await backups.deleteOne({ _id: backup.insertedId });
      result.conflicts.push({ collection: hit.collection, _id: hit._id });
      continue;
    }
    result.documents++;
    result.urlsReplaced += replaced;
  }
  return result;
}

/** Put a run's backed-up values back. Returns how many documents were restored. */
export async function undoRun(db: Db, runId: string): Promise<number> {
  const backups = db.collection(BACKUP_COLLECTION);
  let restored = 0;
  for await (const b of backups.find({ runId, restoredAt: { $exists: false } }).sort({ at: -1 })) {
    await db.collection(String(b.collection)).updateOne({ _id: b.docId } as never, { $set: b.fields as Record<string, unknown> });
    await backups.updateOne({ _id: b._id }, { $set: { restoredAt: new Date() } });
    restored++;
  }
  return restored;
}
