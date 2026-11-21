/**
 * Merges company cards that share a Card ID (an old deactivated card left beside the live one), one-time.
 *
 *   node scripts/card-duplicates-merge.ts            dry run: lists each duplicate group and what would happen
 *   node scripts/card-duplicates-merge.ts --apply    does it, one transaction per Card ID
 *
 * Per Card ID the card kept is the active one (else the most recently changed). Every other row is merged into it:
 * the expenses and Amex statement lines that point at it are re-pointed to the kept card, the kept card's blank
 * Amex name / location are filled from the others, then the extra row is deleted. Nothing about an expense changes
 * (it keeps its own holder, card label and history). Needs DATABASE_URL (Render shell). Safe to run twice.
 */
import { eq, sql } from 'drizzle-orm';
import { openDb } from '../src/db/client.ts';
import { companyCards, cardExpenses } from '../src/db/schema/cardsSuppliers.ts';
import { cardStatementLines } from '../src/db/schema/cardStatements.ts';
import type { Db } from '../src/db/copy/plan.ts';

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Usage: DATABASE_URL=… node scripts/card-duplicates-merge.ts [--apply]'); process.exit(1); }

const { db, close } = await openDb(url);
try {
  const d = db as unknown as Db;
  const all = await d.select().from(companyCards);
  const groups = new Map<string, typeof all>();
  for (const c of all) groups.set(c.label, [...(groups.get(c.label) || []), c]);
  const dupes = [...groups].filter(([, rows]) => rows.length > 1);
  if (!dupes.length) { console.log('No Card ID is used twice. Nothing to merge.'); process.exit(0); }
  let merged = 0;
  for (const [label, rows] of dupes) {
    const sorted = [...rows].sort((a, b) => Number(b.active) - Number(a.active) || +new Date(b.updatedAt) - +new Date(a.updatedAt));
    const keep = sorted[0]!;
    const extras = sorted.slice(1);
    console.log(`\n${label}: keep ${keep.id} (${keep.active ? 'active' : 'inactive'}, holder ${keep.userId || 'none'}); merge ${extras.length} other row${extras.length === 1 ? '' : 's'}`);
    for (const x of extras) {
      const ex = await d.select({ n: sql<number>`count(*)::int` }).from(cardExpenses).where(eq(cardExpenses.cardId, x.id));
      const ln = await d.select({ n: sql<number>`count(*)::int` }).from(cardStatementLines).where(eq(cardStatementLines.cardId, x.id));
      console.log(`  - ${x.id} (${x.active ? 'active' : 'inactive'}, holder ${x.userId || 'none'}): ${ex[0]!.n} expenses, ${ln[0]!.n} statement lines re-pointed, then deleted`);
    }
    if (!apply) continue;
    await (d as unknown as { transaction: (f: (tx: Db) => Promise<void>) => Promise<void> }).transaction(async (tx: Db) => {
      for (const x of extras) {
        await tx.update(cardExpenses).set({ cardId: keep.id }).where(eq(cardExpenses.cardId, x.id));
        await tx.update(cardStatementLines).set({ cardId: keep.id }).where(eq(cardStatementLines.cardId, x.id));
      }
      const amexName = keep.amexName || extras.map(x => x.amexName).find(Boolean) || '';
      const location = keep.location || extras.map(x => x.location).find(Boolean) || '';
      await tx.update(companyCards).set({ amexName, location }).where(eq(companyCards.id, keep.id));
      for (const x of extras) await tx.delete(companyCards).where(eq(companyCards.id, x.id));
    });
    merged += extras.length;
  }
  console.log(apply ? `\nMerged ${merged} extra card rows.` : '\nDry run: nothing changed. Add --apply to merge.');
} finally { await close(); }
