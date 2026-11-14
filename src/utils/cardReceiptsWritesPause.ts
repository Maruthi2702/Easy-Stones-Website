/**
 * The Credit Card Receipts cutover pause (DB_MOVE_CHECKLIST.md §5): while `CARD_RECEIPTS_WRITES_PAUSED=true`,
 * every request that changes a card, a category or an expense answers 503 "back in a few minutes". Reads and
 * every other area carry on. Same idea as dailyReportsWritesPause.ts: one stray save mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PREFIX = '/api/card-receipts';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const cardReceiptsWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.CARD_RECEIPTS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isCardReceiptWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return p === PREFIX || p.startsWith(`${PREFIX}/`);
}

export const CARD_RECEIPTS_PAUSED_MESSAGE = 'Credit Card Receipts is being updated and will be back in a few minutes. Please try again shortly.';

export function cardReceiptsWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (cardReceiptsWritesPaused() && isCardReceiptWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: CARD_RECEIPTS_PAUSED_MESSAGE, paused: true });
  }
  next();
}
