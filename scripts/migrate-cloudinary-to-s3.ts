/**
 * Move every stored file from Cloudinary to S3 (behind CloudFront) and point the
 * records at the new URLs. The engine and its tests: src/services/cloudinaryToS3.ts.
 *
 *   node scripts/migrate-cloudinary-to-s3.ts              # dry run: what would move, per collection and field
 *   node scripts/migrate-cloudinary-to-s3.ts --copy       # copy the files to S3 only (no database writes; rerunnable)
 *   node scripts/migrate-cloudinary-to-s3.ts --apply      # copy, then rewrite the URLs (old values backed up first)
 *   node scripts/migrate-cloudinary-to-s3.ts --undo <run> # put a run's old values back
 *   … --collection customers --collection deliveries      # limit to some collections
 *
 * Needs in .env (or the shell): MONGO_URI, CLOUDINARY_CLOUD_NAME, FILES_BUCKET,
 * FILES_CDN_URL (https://….cloudfront.net, the files stack's CdnUrl output), AWS_REGION,
 * and AWS credentials that can write the bucket (~/.aws/credentials or AWS_* variables).
 *
 * Safe order: dry run → --copy → --apply (on a local copy of the database first —
 * the local .env points at the LIVE database). Cloudinary is never changed, so old
 * links in sent emails and PDFs keep working; keep the account until nothing uses it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { copyFiles, rewriteUrls, scanForCloudinary, undoRun, BACKUP_COLLECTION } from '../src/services/cloudinaryToS3.ts';
import { cacheControlFor, contentTypeForExtension, extensionOf, sniffContentType } from '../src/utils/fileStoreRules.ts';

dotenv.config();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valuesOf = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const mode = flag('--undo') ? 'undo' : flag('--apply') ? 'apply' : flag('--copy') ? 'copy' : 'dry-run';
const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — nothing done.`);
  return v;
};

/** Delivery files overwritten in place (packing lists, signatures, signed PDFs) must not be cached for a year. */
const isFixedName = (key: string) => /^deliveries\/(packing_lists\/|pod\/[^/]+\/(signed|sig_customer|sig_driver)(\.|$))/.test(key);

const main = async () => {
  const mongoUri = need('MONGO_URI');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db!;
  console.log(`Database: ${mongoUri.split('@').pop()?.split('?')[0]}  ·  mode: ${mode}`);

  if (mode === 'undo') {
    const runId = valuesOf('--undo')[0];
    if (!runId) throw new Error('Give the run id: --undo <run>');
    const restored = await undoRun(db, runId);
    console.log(`Restored ${restored} document(s) from ${BACKUP_COLLECTION} (run ${runId}).`);
    return;
  }

  const cloudName = need('CLOUDINARY_CLOUD_NAME');
  const collections = valuesOf('--collection');
  console.log(`Scanning for res.cloudinary.com/${cloudName}/… ${collections.length ? `in ${collections.join(', ')}` : 'in every collection'}`);
  const scan = await scanForCloudinary(db, { cloudName, collections });

  const keys = new Set(scan.urls.values());
  console.log(`\n${scan.hits.length} document(s), ${scan.urls.size} URL(s), ${keys.size} file(s):`);
  for (const [name, s] of Object.entries(scan.byCollection)) {
    console.log(`  ${name.padEnd(28)} ${String(s.documents).padStart(6)} docs   ${Object.entries(s.fields).map(([f, n]) => `${f}×${n}`).join('  ')}`);
  }
  if (scan.unparsed.length) console.log(`  ${scan.unparsed.length} URL(s) not understood — left alone, e.g. ${scan.unparsed[0]}`);
  if (mode === 'dry-run') {
    console.log('\nDry run — nothing copied or changed. Next: --copy, then --apply.');
    return;
  }

  const bucket = need('FILES_BUCKET');
  const cdnBase = need('FILES_CDN_URL').replace(/\/+$/, '');
  if (!/^https:\/\//.test(cdnBase)) throw new Error('FILES_CDN_URL must start with https://');
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

  const copy = await copyFiles(
    scan.urls,
    {
      async exists(key) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          return true;
        } catch (err) {
          const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (status === 404 || status === 403) return false;
          throw err;
        }
      },
      async copy(url, key) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Cloudinary answered ${res.status}`);
        const body = Buffer.from(await res.arrayBuffer());
        const sniffed = sniffContentType(body).contentType;
        const contentType =
          contentTypeForExtension(extensionOf(key)) ||
          (sniffed !== 'application/octet-stream' ? sniffed : res.headers.get('content-type')) ||
          'application/octet-stream';
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControlFor(isFixedName(key)) }));
        return { bytes: body.length };
      },
    },
    { onProgress: (done, total) => done % 25 === 0 && console.log(`  … ${done}/${total}`) },
  );
  console.log(
    `\nCopied ${copy.copied.length} (${(copy.bytes / 1048576).toFixed(1)} MB), already in S3 ${copy.alreadyThere.length}, failed ${copy.failed.length}.`,
  );
  for (const f of copy.failed.slice(0, 20)) console.log(`  ✗ ${f.url} — ${f.error}`);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = path.join(REPORT_DIR, `cloudinary-to-s3-${runId}.json`);
  const report: Record<string, unknown> = { runId, mode, byCollection: scan.byCollection, copy, unparsed: scan.unparsed };

  if (mode === 'apply') {
    const copiedKeys = new Set([...copy.copied, ...copy.alreadyThere]);
    const rewrite = await rewriteUrls(db, scan.hits, { cloudName, cdnBase, urls: scan.urls, copiedKeys, runId });
    report.rewrite = rewrite;
    console.log(`Rewrote ${rewrite.urlsReplaced} URL(s) in ${rewrite.documents} document(s); ${rewrite.conflicts.length} changed meanwhile (rerun to pick them up).`);
    console.log(`Old values are in ${BACKUP_COLLECTION} — undo with: node scripts/migrate-cloudinary-to-s3.ts --undo ${runId}`);
  } else {
    console.log('Copy only — no records changed. Next: --apply.');
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);
};

main()
  .catch((err) => {
    console.error(`❌ ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
