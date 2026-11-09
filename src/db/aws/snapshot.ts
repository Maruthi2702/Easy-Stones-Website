/**
 * A MongoDB read, packed to travel through S3 to the copy Lambda: canonical Extended
 * JSON (ObjectIds, Dates, Decimal128, Binary kept exactly), gzipped.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { EJSON } from 'bson';
import type { CopySource } from '../copy/plan.ts';

export function packSnapshot(src: CopySource): Buffer {
  return gzipSync(Buffer.from(EJSON.stringify(src, { relaxed: false }), 'utf8'));
}

export function unpackSnapshot(body: Uint8Array): CopySource {
  // relaxed: numbers come back as plain numbers, as the MongoDB driver hands them out.
  return EJSON.parse(gunzipSync(body).toString('utf8'), { relaxed: true }) as unknown as CopySource;
}
