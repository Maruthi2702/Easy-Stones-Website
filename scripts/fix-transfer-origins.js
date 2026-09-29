/**
 * One-off: correct the sending branch on three transfers saved before the
 * server checked it (see POST /api/deliveries in src/routes/deliveries.js).
 *
 *   node scripts/fix-transfer-origins.js           # dry run, prints what would change
 *   node scripts/fix-transfer-origins.js --apply   # back up, then write
 *
 * Two were logged by Seattle as Seattle → Seattle; their notes say where they
 * really came from ("INBOUND FROM SLC", "INBOUND FROM SPK"). The third had no
 * origin at all and is Seattle's. Each update only applies if the ticket still
 * has the origin it had when this was written, and the originals are saved to
 * scripts/merge-backups/ first.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const apply = process.argv.includes('--apply');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');

const FIXES = [
  { id: 'del_1787012510182_nh597', from: 'Seattle', to: 'Salt Lake City' }, // #18356, "INBOUND FROM SLC"
  { id: 'del_1787012875676_vskka', from: 'Seattle', to: 'Spokane' },        // #18357, "INBOUND FROM SPK"
  { id: 'del_1786407775212_a784p', from: '', to: 'Seattle' }                // #18299, no origin
];

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('deliveries');
  const before = await col.find({ id: { $in: FIXES.map((f) => f.id) } }).toArray();

  for (const f of FIXES) {
    const doc = before.find((d) => d.id === f.id);
    if (!doc) { console.log(`  ${f.id}  not found — skipped`); continue; }
    const ready = doc.deliveryType === 'transfer' && (doc.location || '') === f.from;
    console.log(
      `  ${f.id}  #${doc.soNumber}  ${doc.location || '(none)'} → ${doc.transferDestination}` +
      (ready ? `   becomes   ${f.to} → ${doc.transferDestination}` : '   already changed — skipped')
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `transfer-origins-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(before, null, 2));
    console.log(`\nBacked up ${before.length} records to ${file}`);
    for (const f of FIXES) {
      const doc = before.find((d) => d.id === f.id);
      if (!doc) continue;
      const r = await col.updateOne(
        { id: f.id, deliveryType: 'transfer', location: f.from },
        { $set: { location: f.to, customerName: `Transfer: ${f.to} → ${doc.transferDestination}`, updatedAt: new Date() } }
      );
      console.log(`  ${f.id}  ${r.modifiedCount ? 'updated' : 'not changed'}`);
    }
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
