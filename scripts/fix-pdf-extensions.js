/**
 * One-off: give every stored delivery PDF a ".pdf" ending so View opens it.
 *
 * Packing lists and signed ePOD PDFs used to go to Cloudinary as raw files
 * with an extensionless id, which Cloudinary serves as a download. New ones
 * are stored with ".pdf" (storeDeliveryPdf in src/routes/deliveries.js); this
 * moves the old ones across: download, check it is a real PDF, upload under
 * "<old id>.pdf", point the delivery at the new URL.
 *
 * Dry run by default (writes nothing). Pass --apply to do it. The old files
 * are left on Cloudinary, so nothing is lost if a copy turns out wrong.
 * Writes go straight to the collection, so "last changed" isn't touched.
 * Safe to re-run: anything already ending in .pdf is skipped.
 *
 *   node scripts/fix-pdf-extensions.js            # list what would change
 *   node scripts/fix-pdf-extensions.js --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import Delivery from '../src/models/Delivery.js';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const isOldRawUrl = (url) =>
  /^https:\/\/res\.cloudinary\.com\/[^/]+\/raw\/upload\//.test(url || '') &&
  !/\.pdf(\?.*)?$/i.test(url);

// https://res.cloudinary.com/<cloud>/raw/upload/v123/deliveries/x/ID -> deliveries/x/ID
const publicIdFromUrl = (url) =>
  decodeURIComponent(url.split('/raw/upload/')[1].split('?')[0].replace(/^v\d+\//, ''));

const upload = (buffer, publicId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: 'raw', overwrite: true, invalidate: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// Returns { url, publicId } for the .pdf copy, or null if it was skipped.
const moveToPdf = async (label, oldUrl) => {
  const res = await fetch(oldUrl);
  if (!res.ok) { console.log(`  ✗ ${label}: download failed (${res.status})`); return null; }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    console.log(`  ✗ ${label}: not a PDF, left alone`);
    return null;
  }
  const newId = `${publicIdFromUrl(oldUrl)}.pdf`;
  if (!APPLY) { console.log(`  • ${label}: would store as ${newId}`); return null; }
  const result = await upload(buffer, newId);
  console.log(`  ✓ ${label}: ${result.secure_url}`);
  return { url: result.secure_url, publicId: result.public_id };
};

const run = async () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary env vars are not set');
  }
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  await mongoose.connect(process.env.MONGO_URI);

  const docs = await Delivery.find(
    {
      $or: [
        { packingListUrl: /res\.cloudinary\.com\/[^/]+\/raw\/upload\// },
        { 'pod.signedPdfUrl': /res\.cloudinary\.com\/[^/]+\/raw\/upload\// }
      ]
    },
    'id packingListUrl pod.signedPdfUrl'
  ).lean();

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}: ${docs.length} deliveries with a hosted PDF`);
  let moved = 0;
  let todo = 0;

  for (const d of docs) {
    const set = {};
    if (isOldRawUrl(d.packingListUrl)) {
      todo += 1;
      const r = await moveToPdf(`${d.id} packing list`, d.packingListUrl);
      if (r) { set.packingListUrl = r.url; set.packingListPublicId = r.publicId; }
    }
    if (isOldRawUrl(d.pod?.signedPdfUrl)) {
      todo += 1;
      const r = await moveToPdf(`${d.id} signed copy`, d.pod.signedPdfUrl);
      if (r) { set['pod.signedPdfUrl'] = r.url; set['pod.signedPdfPublicId'] = r.publicId; }
    }
    if (Object.keys(set).length) {
      await Delivery.collection.updateOne({ _id: d._id }, { $set: set });
      moved += Object.keys(set).length / 2;
    }
  }

  console.log(`\n${todo} PDFs need the fix; ${APPLY ? `${moved} moved` : 'nothing written (run with --apply)'}.`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
