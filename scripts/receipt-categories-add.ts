/**
 * Adds accounting's expense account list (30 names) as Credit Card Receipts categories, exactly as written
 * (owner, 2026-11-20). Names already on the list are skipped. List and rules: src/db/cardReceipts/addCategories.ts.
 *
 *   DATABASE_URL=… node scripts/receipt-categories-add.ts            dry run: what would be added, nothing written
 *   DATABASE_URL=… node scripts/receipt-categories-add.ts --apply    adds them
 *
 * Safe to run twice. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { addCategories, ACCOUNTING_CATEGORIES } from '../src/db/cardReceipts/addCategories.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/receipt-categories-add.ts [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const r = await addCategories(db as unknown as Db, ACCOUNTING_CATEGORIES, 'Categories setup', { preview: !apply });
  console.log(`${apply ? 'Added' : 'Would add'} ${r.added.length} of ${ACCOUNTING_CATEGORIES.length}:`);
  for (const l of r.added) console.log(`  + ${l}`);
  if (r.skipped.length) console.log(`Already there (skipped ${r.skipped.length}): ${r.skipped.join(', ')}`);
  console.log(apply ? 'Done.' : 'Dry run: nothing changed. Add --apply to add them.');
} finally { await close(); }
