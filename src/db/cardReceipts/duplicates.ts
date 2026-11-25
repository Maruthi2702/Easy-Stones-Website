/**
 * Looking for duplicate card expenses (owner's ask, 2026-11-25). Read-only: it lists, it never changes anything.
 *
 * Two kinds of group, voided expenses left out:
 *  - **photo**: two or more expenses saved with the same receipt photo / file (`receipt_hash`, the SHA-256 the app keeps
 *    since 2026-11-24). The same file twice is almost always one receipt uploaded twice.
 *  - **charge**: the same card, the same day and the same amount. Each group says whether it is **likely** (the merchant reads
 *    the same) or **maybe** (different merchants: usually two real purchases), and whether every expense in it answers its
 *    **own** Amex / Encore statement line (then they are two separate charges, not a duplicate).
 */
import { isNull, sql } from 'drizzle-orm';
import { cardExpenses } from '../schema/cardsSuppliers.ts';
import { cardStatementLines } from '../schema/cardStatements.ts';
import type { Db } from '../copy/plan.ts';

export interface DupExpense {
  id: string; holderName: string; cardLabel: string; day: string; cents: number; merchant: string; status: string;
  hasReceipt: boolean; lineRef: string;
}
export interface DupGroup {
  kind: 'photo' | 'charge';
  /** 'likely' = same merchant (or the same photo); 'maybe' = different merchants; 'separate' = each has its own statement line. */
  confidence: 'likely' | 'maybe' | 'separate';
  key: string;
  expenses: DupExpense[];
}

/** "AplPay CHEVRON  0205" → "chevron 0205": case, spacing and a leading wallet word don't make a different merchant. */
export const merchantKey = (merchant: string) =>
  merchant.toLowerCase().replace(/^(aplpay|apple pay|google pay|gpay|sq \*|tst\*|sp )\s*/i, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function groupDuplicates(rows: readonly DupExpense[], photo: ReadonlyMap<string, string>): DupGroup[] {
  const groups: DupGroup[] = [];
  const byPhoto = new Map<string, DupExpense[]>();
  for (const r of rows) {
    const h = photo.get(r.id);
    if (h) byPhoto.set(h, [...(byPhoto.get(h) ?? []), r]);
  }
  for (const [hash, list] of byPhoto) if (list.length > 1) groups.push({ kind: 'photo', confidence: 'likely', key: hash.slice(0, 12), expenses: list });

  const byCharge = new Map<string, DupExpense[]>();
  for (const r of rows) {
    const k = `${r.cardLabel}|${r.day}|${r.cents}`;
    byCharge.set(k, [...(byCharge.get(k) ?? []), r]);
  }
  for (const [key, list] of byCharge) {
    if (list.length < 2) continue;
    const ownLines = list.every(e => e.lineRef) && new Set(list.map(e => e.lineRef)).size === list.length;
    const sameMerchant = new Set(list.map(e => merchantKey(e.merchant))).size === 1;
    groups.push({ kind: 'charge', confidence: ownLines ? 'separate' : sameMerchant ? 'likely' : 'maybe', key, expenses: list });
  }
  const order = { likely: 0, maybe: 1, separate: 2 } as const;
  return groups.sort((a, b) => order[a.confidence] - order[b.confidence] || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

export async function findDuplicates(db: Db): Promise<DupGroup[]> {
  const rows = await db.select({
    id: cardExpenses.id, holderName: cardExpenses.holderName, cardLabel: cardExpenses.cardLabel, day: cardExpenses.day, cents: cardExpenses.cents,
    merchant: cardExpenses.merchant, status: cardExpenses.status, receiptUrl: cardExpenses.receiptUrl, lostReason: cardExpenses.lostReason,
    hash: cardExpenses.receiptHash,
    lineRef: sql<string>`coalesce((select l.reference from ${cardStatementLines} l where l.expense_id = ${cardExpenses.id} limit 1), '')`
  }).from(cardExpenses).where(isNull(cardExpenses.voidedAt));
  const photo = new Map<string, string>();
  const list: DupExpense[] = rows.map(r => {
    if (r.hash) photo.set(r.id, r.hash);
    return { id: r.id, holderName: r.holderName, cardLabel: r.cardLabel, day: String(r.day), cents: Number(r.cents), merchant: r.merchant, status: r.status, hasReceipt: Boolean(r.receiptUrl || r.lostReason), lineRef: r.lineRef };
  });
  return groupDuplicates(list, photo);
}
