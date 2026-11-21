/**
 * Moves the old Credit Card Receipts categories onto Gas and Food with sub-categories (owner, 2026-11-20):
 *   Fuel → Gas · Car;  Travel Lunch → Food · Travel Lunch;  Customer Lunch → Food · Customer Lunch.
 * The old categories are hidden, not deleted; every moved expense gets a history line. Rules and the
 * reasoning: src/db/cardReceipts/subcategoryConvert.ts.
 *
 *   DATABASE_URL=… node scripts/receipt-subcategories-convert.ts            dry run: counts, nothing written
 *   DATABASE_URL=… node scripts/receipt-subcategories-convert.ts --apply    does it
 *
 * Safe to run twice. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { convertToSubcategories } from '../src/db/cardReceipts/subcategoryConvert.ts';
import { formatMoney } from '../src/utils/cardReceipts.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/receipt-subcategories-convert.ts [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const r = await convertToSubcategories(db as unknown as Db, 'Sub-categories setup', { preview: !apply });
  const verb = apply ? '' : 'would be ';
  console.log(r.created.length ? `Categories ${verb}created: ${r.created.join(', ')}` : 'Gas and Food are already there.');
  if (r.addedTypes.length) console.log(`Types ${verb}added: ${r.addedTypes.join(', ')}`);
  for (const m of r.moves) {
    const by = Object.entries(m.byStatus).map(([s, n]) => `${n} ${s}`).join(', ');
    console.log(`${m.from} → ${m.to}: ${m.expenses} expenses ${verb}moved${m.expenses ? ` (${by}) · ${formatMoney(m.cents)}` : ''}`);
  }
  if (r.notFound.length) console.log(`Not found (skipped): ${r.notFound.join(', ')}`);
  console.log(r.hidden.length ? `Old categories ${verb}hidden: ${r.hidden.join(', ')}` : 'No old category left to hide.');
  console.log(apply ? 'Done.' : 'Dry run: nothing changed. Add --apply to do it.');
} finally { await close(); }
