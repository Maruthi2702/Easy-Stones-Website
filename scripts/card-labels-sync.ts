/**
 * Gives every card expense its card's current Card ID, one-time (a card renamed before 2026-11-24 left its
 * expenses with the old ID; renaming a card now updates them itself).
 *
 *   node scripts/card-labels-sync.ts            dry run: lists each card whose expenses show another ID
 *   node scripts/card-labels-sync.ts --apply    does it, in one transaction
 *
 * Only `card_label` changes, on expenses whose `card_id` is a card with a different label. Needs DATABASE_URL
 * (Render shell). Safe to run twice.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { openDb } from '../src/db/client.ts';
import { companyCards, cardExpenses } from '../src/db/schema/cardsSuppliers.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-labels-sync.ts [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const stale = await d.select({ cardId: companyCards.id, now: companyCards.label, was: cardExpenses.cardLabel, n: sql<number>`count(*)::int` })
    .from(cardExpenses).innerJoin(companyCards, eq(companyCards.id, cardExpenses.cardId))
    .where(ne(cardExpenses.cardLabel, companyCards.label))
    .groupBy(companyCards.id, companyCards.label, cardExpenses.cardLabel);
  if (!stale.length) { console.log('Every expense shows its card’s current ID. Nothing to do.'); process.exit(0); }
  for (const r of stale) console.log(`${r.was} → ${r.now}: ${r.n} expense${r.n === 1 ? '' : 's'}`);
  if (!apply) { console.log('\nDry run. Run again with --apply to change them.'); process.exit(0); }
  await d.transaction(async (tx: Db) => {
    for (const r of stale) await tx.update(cardExpenses).set({ cardLabel: r.now }).where(and(eq(cardExpenses.cardId, r.cardId), eq(cardExpenses.cardLabel, r.was)));
  });
  console.log(`\nDone: ${stale.reduce((a, r) => a + r.n, 0)} expenses updated.`);
} finally {
  await close();
}
