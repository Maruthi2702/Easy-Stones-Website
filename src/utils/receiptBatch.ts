/**
 * Add several receipts at once (2026-11-24, owner's ask): accounting adds a pile of receipts for ONE cardholder and
 * ONE card, each saved as its own expense with its own category and note. Rules shared by the screen and the server;
 * the screen is src/features/cardReceipts/bulk/.
 */

/** Most receipts in one batch (owner: 25 is enough; the upload and reading limits per person are 100 / 40 per 10 minutes). */
export const MAX_BATCH = 25;

/** How many more files the batch can take, and a sentence when some were left out. */
export const batchRoom = (have: number) => Math.max(0, MAX_BATCH - have);
export const batchLeftOut = (have: number, adding: number): string => {
  const left = adding - batchRoom(have);
  return left > 0 ? `A batch holds up to ${MAX_BATCH} receipts: ${left} ${left === 1 ? 'file was' : 'files were'} left out.` : '';
};

/** What each save sends to say it is one of a batch: "3 of 5". */
export type BatchMarker = { n: number; of: number };
export const isBatchMarker = (v: unknown): v is BatchMarker => {
  if (!v || typeof v !== 'object') return false;
  const { n, of } = v as Record<string, unknown>;
  return Number.isInteger(n) && Number.isInteger(of) && (n as number) >= 1 && (of as number) <= MAX_BATCH && (n as number) <= (of as number);
};
/** The line the receipt's history keeps. */
export const batchNote = (m: BatchMarker) => `added in a batch (${m.n} of ${m.of})`;

/**
 * Where one receipt of the batch stands before Save all. `incomplete` = lacks a category, type, customer or note; `blocked` =
 * lacks a merchant, day or total too. Either way Save all leaves it unsaved and shows what's missing (no drafts, 2026-11-26).
 */
export type RowReadiness = 'ready' | 'incomplete' | 'blocked';
export const rowReadiness = (check: { value?: unknown; missing: Record<string, unknown> }): RowReadiness =>
  !check.value ? 'blocked' : Object.keys(check.missing).length === 0 ? 'ready' : 'incomplete';

/** What a finished batch says: "4 sent for approval · 2 replaced report rows". (An older saved receipt that stays as it was counts as sent.) */
export function batchSummary(saved: { status: string; matchedMissing: boolean; /** It updated a receipt already saved instead of adding one. */ merged?: boolean }[], failed: number): string {
  const added = saved.filter((s) => !s.merged);
  const sent = added.length;
  const matched = saved.filter((s) => s.matchedMissing).length;
  const merged = saved.length - added.length;
  return [
    sent ? `${sent} sent for approval` : '',
    merged ? `${merged} updated ${merged === 1 ? 'a saved receipt' : 'saved receipts'}` : '',
    matched ? `${matched} replaced ${matched === 1 ? 'a report row' : 'report rows'}` : '',
    failed ? `${failed} didn’t save` : ''
  ].filter(Boolean).join(' · ');
}
