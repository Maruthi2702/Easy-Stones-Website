/**
 * Move photos stored inline (base64 inside the customer record) to Cloudinary.
 *
 *   node scripts/migrate-inline-images.js           # dry run: what would move, and how much smaller records get
 *   node scripts/migrate-inline-images.js --apply   # back up, upload, replace with URLs
 *
 * Between Dec 2025 and Jan 2026 an upload bug left 27 visit/resource photos
 * saved as base64 strings inside their customer's document instead of as a
 * Cloudinary URL — making some customers 1.2–1.8 MB where a typical one is
 * ~40 KB. Every open or refresh of those customers downloaded all of it, and
 * every dashboard rollup unpacked it. New uploads haven't done this since.
 *
 * Each photo gets the same treatment a new visit photo does on the server
 * (processBase64Image in server.js): resized to fit 1000px, WebP quality 75,
 * uploaded to the same folder. Inline PDFs (6 on visits, the newest Feb 2026)
 * go up as Cloudinary raw files named *.pdf, the way new visit PDFs now do
 * (processBase64Pdf in server.js), so isPdfSource still shows them as PDFs.
 * Only that one entry's `image` field is written, matched by the entry's _id;
 * anything else about the visit/resource is left alone. The original values
 * are written to scripts/merge-backups/ (git-ignored) before anything changes.
 * Any other inline data type is reported but not touched.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

const apply = process.argv.includes('--apply');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');
const FOLDER = { visits: 'visits', resources: 'Resources' };

const isInlineImage = (v) => typeof v === 'string' && v.startsWith('data:image/');
const isInlinePdf = (v) => typeof v === 'string' && v.startsWith('data:application/pdf');
const isInlineOther = (v) => typeof v === 'string' && v.startsWith('data:') && !isInlineImage(v) && !isInlinePdf(v);
const asList = (img) => (Array.isArray(img) ? img : img ? [img] : []);
const kb = (bytes) => Math.round(bytes / 1024);

const upload = async (dataUrl, folder) => {
  const buffer = Buffer.from(dataUrl.split(';base64,').pop(), 'base64');
  const optimized = await sharp(buffer)
    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75, effort: 2 })
    .toBuffer();
  const publicId = `img_migrated_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: 'image' },
      (error, res) => (error ? reject(error) : resolve(res))
    ).end(optimized);
  });
  return result.secure_url;
};

const uploadPdf = async (dataUrl, folder) => {
  const buffer = Buffer.from(dataUrl.split(';base64,').pop(), 'base64');
  const publicId = `pdf_migrated_${Date.now()}_${Math.round(Math.random() * 1e9)}.pdf`;
  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: 'raw' },
      (error, res) => (error ? reject(error) : resolve(res))
    ).end(buffer);
  });
  return result.secure_url;
};

const main = async () => {
  if (apply && !(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)) {
    throw new Error('Cloudinary is not configured in .env — nothing written.');
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('customers');

  const docs = await col.find(
    { $or: [{ 'visits.image': /^data:/ }, { 'resources.image': /^data:/ }] },
    { projection: { 'visits._id': 1, 'visits.image': 1, 'resources._id': 1, 'resources.image': 1 } }
  ).toArray();

  // One job per visit/resource entry holding inline data.
  const jobs = [];
  for (const doc of docs) {
    for (const kind of ['visits', 'resources']) {
      for (const entry of doc[kind] || []) {
        const list = asList(entry.image);
        const images = list.filter(isInlineImage);
        const pdfs = list.filter(isInlinePdf);
        const others = list.filter(isInlineOther);
        if (images.length || pdfs.length || others.length) {
          jobs.push({ customerId: doc._id, kind, entryId: entry._id, image: entry.image, images, pdfs, others });
        }
      }
    }
  }

  // Real stored sizes (the find above only fetched the attachment fields).
  const sizes = new Map((await col.aggregate([
    { $match: { _id: { $in: docs.map((d) => d._id) } } },
    { $project: { s: { $bsonSize: '$$ROOT' } } }
  ]).toArray()).map((r) => [String(r._id), r.s]));
  const sizeOf = (doc) => sizes.get(String(doc._id)) || 0;
  console.log(`${docs.length} customers, ${jobs.length} entries, ${jobs.reduce((n, j) => n + j.images.length, 0)} inline photos, ${jobs.reduce((n, j) => n + j.pdfs.length, 0)} inline PDFs.\n`);
  for (const doc of docs) {
    const mine = jobs.filter((j) => String(j.customerId) === String(doc._id));
    const inlineBytes = mine.reduce((n, j) => n + [...j.images, ...j.pdfs].reduce((m, s) => m + s.length, 0), 0);
    const what = mine.map((j) => `${j.kind.slice(0, -1)} ×${j.images.length}${j.pdfs.length ? ` +${j.pdfs.length} PDF` : ''}`).join(', ');
    console.log(`  customer ${doc._id}  ~${kb(sizeOf(doc))} KB now, ~${kb(sizeOf(doc) - inlineBytes)} KB after  (${what})`);
  }
  const otherCount = jobs.reduce((n, j) => n + j.others.length, 0);
  if (otherCount) console.log(`\n${otherCount} other inline files (not images or PDFs) found — reported only, not moved.`);

  if (!apply) {
    console.log('\nDry run — nothing uploaded or written. Re-run with --apply to move them.');
    await mongoose.disconnect();
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupFile = path.join(BACKUP_DIR, `inline-images-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(jobs.map(({ customerId, kind, entryId, image }) => ({ customerId, kind, entryId, image }))));
  console.log(`\nBacked up ${jobs.length} entries' original image values to ${backupFile}`);

  let moved = 0;
  for (const job of jobs) {
    if (!job.images.length && !job.pdfs.length) continue;
    try {
      const urls = new Map();
      for (const img of job.images) urls.set(img, await upload(img, FOLDER[job.kind]));
      for (const pdf of job.pdfs) urls.set(pdf, await uploadPdf(pdf, FOLDER[job.kind]));
      const replaced = Array.isArray(job.image)
        ? job.image.map((v) => urls.get(v) || v)
        : (urls.get(job.image) || job.image);
      const res = await col.updateOne(
        { _id: job.customerId, [`${job.kind}._id`]: job.entryId },
        { $set: { [`${job.kind}.$.image`]: replaced } }
      );
      const count = job.images.length + job.pdfs.length;
      moved += res.modifiedCount ? count : 0;
      console.log(`  ${job.kind.slice(0, -1)} ${job.entryId}: ${res.modifiedCount ? `moved ${count}` : 'not changed'}`);
    } catch (err) {
      console.error(`  ${job.kind.slice(0, -1)} ${job.entryId}: FAILED (${err.message}) — left as it was`);
    }
  }
  console.log(`\nMoved ${moved} files (photos and PDFs) to Cloudinary.`);
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect();
  process.exit(1);
});
