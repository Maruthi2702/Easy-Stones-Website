/**
 * Lists possible duplicate card expenses. Read-only: it never changes anything.
 *
 *   DATABASE_URL=… node scripts/card-expense-duplicates.ts
 *
 * Groups (voided expenses left out): the same receipt photo on two expenses, and the same card + day + amount, marked
 * likely (same merchant), maybe (different merchants) or separate (each answers its own bank statement line, so they are
 * two real charges). Rules: src/db/cardReceipts/duplicates.ts. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { findDuplicates } from '../src/db/cardReceipts/duplicates.ts';
import type { Db } from '../src/db/copy/plan.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-expense-duplicates.ts'); process.exit(1); }
const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const { db, close } = await openDb(url);
try {
  const groups = await findDuplicates(db as unknown as Db);
  const by = (k: string) => groups.filter(g => g.confidence === k);
  console.log(`Groups: ${by('likely').length} likely · ${by('maybe').length} maybe · ${by('separate').length} separate (own statement lines)\n`);
  for (const g of groups.filter(x => x.confidence !== 'separate')) {
    console.log(`[${g.confidence.toUpperCase()}] ${g.kind === 'photo' ? `same photo ${g.key}…` : g.key.replace(/\|/g, ' · ')}`);
    for (const e of g.expenses) console.log(`   ${e.id}  ${e.day}  ${e.holderName} (${e.cardLabel})  ${e.merchant}  ${money(e.cents)}  ${e.status}${e.hasReceipt ? '' : ' · no receipt'}${e.lineRef ? ` · line ${e.lineRef}` : ''}`);
  }
  if (!by('likely').length && !by('maybe').length) console.log('No duplicates to look at.');
  if (by('separate').length) console.log(`\n${by('separate').length} more groups have the same card, day and amount but each expense answers its own statement line: separate charges, not listed.`);
} finally {
  await close();
}
