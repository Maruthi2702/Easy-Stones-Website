/**
 * Stopgap (owner, 2026-11-20): put a month's Amex charges from before the check started into
 * Credit Card Receipts → Expenses as Approved, so they can be viewed there and read "Receipt
 * uploaded" on Statements. No receipt exists for them; each row's note and history say so.
 *
 *   DATABASE_URL=… node scripts/amex-month-approve.ts 2026-10            dry run: counts, nothing written
 *   DATABASE_URL=… node scripts/amex-month-approve.ts 2026-10 --apply    creates the expenses
 *
 * Only charges on a card that is set up (the holder gets the expense), with no expense yet. Safe to
 * run twice: a charge that has an expense is skipped. Needs DATABASE_URL (Render shell).
 */
import { openDb } from '../src/db/client.ts';
import { approveMonthWithoutReceipts } from '../src/db/cardStatements/index.ts';
import type { Db } from '../src/db/copy/plan.ts';

const [month] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !url) {
  console.error('Usage: DATABASE_URL=… node scripts/amex-month-approve.ts YYYY-MM [--apply]');
  process.exit(1);
}

const { db, close } = await openDb(url);
try {
  const by = { id: 'amex-month-approve', name: 'Amex backfill' };
  const r = await approveMonthWithoutReceipts(month, by, { preview: !apply }, db as unknown as Db);
  const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  console.log(`${month}: ${r.charges} charges on the statements · ${r.cardNotSetUp} on a card not set up (skipped)`);
  console.log(`${apply ? 'Added' : 'Would add'} ${apply ? r.added : r.toAdd} Approved expenses · ${money(r.cents)}`);
  if (!apply && r.toAdd) console.log('Dry run: nothing changed. Add --apply to create them.');
} finally { await close(); }
