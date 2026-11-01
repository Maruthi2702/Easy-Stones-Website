import type { Loose } from '../src/types/records.ts';
/**
 * One-off: switch every customer's Moda Display / Binders to "counted from
 * resources" (src/utils/modaTotals.ts, 2026-11-01).
 *
 *   node scripts/moda-switch.ts           # dry run: counts, and every customer whose numbers change
 *   node scripts/moda-switch.ts --apply   # back up, then write
 *
 * Each customer without an earlier count gets one: what was typed beyond the
 * Active tower / binder resources already logged. Nobody's numbers go down; a
 * customer whose resources hold more than was typed (typed 0, 3 binders
 * logged) goes up, and those are listed. The server works the earlier count
 * out the same way the first time a customer's resources change, so the app
 * is right before and after this runs; this brings the list, filters and
 * exports in line for everyone at once. Each update applies only if the
 * customer still has the values read here; the originals are saved to
 * scripts/merge-backups/ first.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { familyLookup, earlierCount, modaFields, type ModaCustomer, type ModaResource } from '../src/utils/modaTotals.ts';

dotenv.config();

const apply = process.argv.includes('--apply');
const BACKUP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-backups');

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const db = mongoose.connection.db!;
  const familyOf = familyLookup(await db.collection<{ name?: unknown; family?: unknown }>('resourcetypes').find({}, { projection: { name: 1, family: 1 } }).toArray());
  const customers = await db.collection<ModaCustomer & { company?: string; contactName?: string; resources?: ModaResource[] }>('customers').find(
    { 'modaEarlier.binders': { $exists: false } },
    { projection: { company: 1, contactName: 1, modaDisplay: 1, modaBinder: 1, modaEarlier: 1, 'resources.resourceType': 1, 'resources.title': 1, 'resources.qty': 1, 'resources.status': 1 } }
  ).toArray();

  const updates: Loose[] = [];
  const changed: Loose[] = [];
  for (const c of customers) {
    const fields = modaFields(earlierCount(c, c.resources, familyOf), c.resources, familyOf);
    updates.push({ c, fields });
    if (fields.modaDisplay !== (c.modaDisplay === 'Yes' ? 'Yes' : 'No') || fields.modaBinder !== String(c.modaBinder ?? '0')) changed.push({ c, fields });
  }

  const name = (c: Loose) => c.company || c.contactName || String(c._id);
  console.log(`${customers.length} customers without an earlier count; ${changed.length} show different numbers after the switch:\n`);
  for (const { c, fields } of changed) {
    console.log(`  ${name(c)}  Display ${c.modaDisplay || 'No'} → ${fields.modaDisplay}  Binders ${c.modaBinder ?? '0'} → ${fields.modaBinder}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to save.');
  } else if (updates.length) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `moda-switch-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(updates.map(({ c }) => ({ _id: c._id, modaDisplay: c.modaDisplay, modaBinder: c.modaBinder })), null, 2));
    console.log(`\nOriginals saved to ${file}`);
    let written = 0;
    for (const { c, fields } of updates) {
      const result = await db.collection('customers').updateOne(
        { _id: c._id, modaDisplay: c.modaDisplay, modaBinder: c.modaBinder, 'modaEarlier.binders': { $exists: false } },
        { $set: fields }
      );
      written += result.modifiedCount;
    }
    console.log(`${written} of ${updates.length} customers written (the rest changed since they were read; re-run for them).`);
  }
  await mongoose.disconnect();
};

main().catch((error) => { console.error(error); process.exit(1); });
