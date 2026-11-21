/**
 * What Credit Card Receipts' own routes (src/routes/cardReceipts.ts) ask of the Amex check.
 * Both do nothing while Credit Card Receipts is on MongoDB (the check is Postgres only).
 */
import { areaOn } from '../appDb.ts';
import { claimUpload, linkedLine, recheck, amexNamesByDigits } from './index.ts';

const on = () => areaOn('card_receipts') === 'postgres';

/**
 * A receipt the cardholder just saved: if an Amex charge was waiting for it, the charge points
 * at it and that charge's Missing receipt row is voided. Returns the voided row's id, or null.
 * Never fails the save: the next upload's check finds the match anyway.
 */
export async function afterReceiptSaved(expense: { _id?: unknown; id?: unknown; cardId?: unknown; date?: unknown; cents?: unknown; merchant?: unknown }, by: { id: string; name: string }) {
  if (!on()) return null;
  try {
    const voided = await claimUpload({
      id: String(expense._id ?? expense.id), cardId: String(expense.cardId ?? ''), date: String(expense.date ?? ''),
      cents: Number(expense.cents), merchant: String(expense.merchant ?? '')
    }, by);
    return voided || null;
  } catch (error) {
    console.error('[card-statements] matching a new receipt failed:', error);
    return null;
  }
}

/**
 * A card was added or changed: charges on a card that now has a holder get their Missing receipt
 * rows (the check runs again over everything waiting). Never fails the save.
 */
export async function afterCardSaved(by: { id: string; name: string }) {
  if (!on()) return;
  try {
    await recheck(by);
  } catch (error) {
    console.error('[card-statements] checking after a card change failed:', error);
  }
}

/** The name Amex prints for a card (by its last 4 or 5 digits), for the Cards screen; '' when no upload has it. */
export async function amexNameLookup(): Promise<(lastDigits: string) => string> {
  if (!on()) return () => '';
  try {
    const names = await amexNamesByDigits();
    return (last) => names.get(last) ?? [...names].find(([digits]) => last.length >= 4 && digits.endsWith(last))?.[1] ?? '';
  } catch (error) {
    console.error('[card-statements] reading Amex card member names failed:', error);
    return () => '';
  }
}

/**
 * The Amex charge (its Reference) an expense answers, or null when it answers none. When the lookup
 * itself fails this throws: the callers guard a void / date / amount change, and an unreadable link
 * must not read as "no charge" (the save fails instead, and can be retried).
 */
export async function amexChargeOf(expenseId: string) {
  if (!on()) return null;
  try {
    return await linkedLine(expenseId);
  } catch (error) {
    console.error('[card-statements] reading an expense’s Amex charge failed:', error);
    throw error;
  }
}
