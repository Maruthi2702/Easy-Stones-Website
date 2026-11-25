/**
 * How many receipts the Amex report uploaded today has, and how many Amex expenses there are. Read-only.
 *
 *   DATABASE_URL=… node scripts/card-receipt-counts.ts                    Amex, today (Pacific)
 *   DATABASE_URL=… node scripts/card-receipt-counts.ts --day=2026-11-25   another day
 *   DATABASE_URL=… node scripts/card-receipt-counts.ts --bank=encore      the other bank
 *
 * Rules and the meaning of each count: src/db/cardStatements/receiptCounts.ts. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { receiptCounts } from '../src/db/cardStatements/receiptCounts.ts';
import type { Db } from '../src/db/copy/plan.ts';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim() ?? '';
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-receipt-counts.ts [--day=YYYY-MM-DD] [--bank=amex|encore]'); process.exit(1); }
const bank = flag('bank') === 'encore' ? 'encore' : 'amex';

const { db, close } = await openDb(url);
try {
  const r = await receiptCounts(db as unknown as Db, { day: flag('day') || undefined, issuer: bank });
  console.log(`${bank.toUpperCase()} uploads on ${r.day}: ${r.uploads.length}`);
  r.uploads.forEach(u => console.log(`  ${u.at.toISOString()}  ${u.fileName}  ${u.lines} lines (${u.added} new)  by ${u.byName}`));
  console.log(`\nLines those uploads carry: ${r.lines.total} (${r.lines.charges} charges, ${r.lines.credits} credits / payments / fees)`);
  console.log(`  Charges with a receipt (file or lost-receipt reason): ${r.charges.receipt}`);
  console.log(`  Charges with an expense but no receipt file:          ${r.charges.noFile}`);
  console.log(`  Charges with a Missing receipt row:                   ${r.charges.missing}`);
  console.log(`  Charges with no expense at all:                       ${r.charges.none}`);
  console.log(`\n${bank.toUpperCase()} expenses (voided left out): ${r.expenses.total}`);
  console.log(`  With a receipt (file or lost-receipt reason): ${r.expenses.withReceipt}`);
  console.log(`  Without a receipt file:                       ${r.expenses.noFile}`);
  const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  console.log(`
Charges with no expense: ${r.noExpense.length}`);
  r.noExpense.slice(0, 50).forEach(c => console.log(`  ${c.day}  ${c.cardMember} (…${c.digits})  ${c.description}  ${money(c.cents)}  line ${c.reference}
      why: ${c.why}`));
  console.log(`Expenses no statement line points at: ${r.unlinked.length}`);
  r.unlinked.slice(0, 50).forEach(e => console.log(`  ${e.day}  ${e.holderName} (${e.cardLabel})  ${e.merchant}  ${money(e.cents)}  ${e.status}${e.hasReceipt ? ' · has a receipt' : ' · no receipt file'}  id ${e.id}`));
  console.log(`
  By status: ${Object.entries(r.expenses.byStatus).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}`);
} finally {
  await close();
}
