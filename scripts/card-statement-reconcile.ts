/**
 * Reconciles the statement lines in the app with the Excel file they came from. Read-only.
 *
 *   DATABASE_URL=… node scripts/card-statement-reconcile.ts                 Amex, then Encore
 *   DATABASE_URL=… node scripts/card-statement-reconcile.ts --bank=encore   one bank only (amex | encore)
 *
 * Prints the lines' charge counts and dollars per charge day and per card, to set beside the same totals from the Excel
 * file, and lists every line whose expense doesn't fit it (different amount, more than 2 days apart, voided, another card
 * and holder) — that list should be empty. Rules: src/db/cardStatements/reconcile.ts. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { reconcile } from '../src/db/cardStatements/reconcile.ts';
import type { Db } from '../src/db/copy/plan.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-statement-reconcile.ts [--bank=amex|encore]'); process.exit(1); }
const only = process.argv.find(a => a.startsWith('--bank='))?.slice(7);
const banks = only === 'amex' || only === 'encore' ? [only] : ['amex', 'encore'];
const dollars = (c: number) => (c / 100).toFixed(2);

const { db, close } = await openDb(url);
try {
  for (const bank of banks) {
  const r = await reconcile(db as unknown as Db, { issuer: bank });
  console.log(`
==================== ${bank.toUpperCase()} ====================`);
  console.log(`${bank.toUpperCase()} statement lines: ${r.totals.lines} (${r.totals.charges} charges $${dollars(r.totals.chargeCents)}, ${r.totals.credits} credits / payments / fees)`);
  console.log(`Charges with no expense: ${r.noExpense}`);
  console.log(`\nLines whose expense doesn't fit: ${r.badLinks.length}`);
  r.badLinks.slice(0, 50).forEach(b => console.log(`  line ${b.reference}  ${b.lineDay} $${dollars(b.lineCents)}  ↔ expense ${b.expenseId}  ${b.expenseDay} $${dollars(b.expenseCents)}  ${b.why}`));
  console.log('\nCHARGES BY DAY (day  count  dollars)');
  r.byDay.forEach(d => console.log(`${d.day} ${String(d.charges).padStart(4)} ${dollars(d.cents).padStart(12)}`));
  console.log('\nCHARGES BY CARD (last digits  count  dollars)');
  r.byCard.forEach(c => console.log(`${c.digits.padEnd(6)} ${String(c.charges).padStart(4)} ${dollars(c.cents).padStart(12)}`));
  }
} finally {
  await close();
}
