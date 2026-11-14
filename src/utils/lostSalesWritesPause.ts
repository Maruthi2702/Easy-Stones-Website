/**
 * The Lost Sales cutover pause (DB_MOVE_CHECKLIST.md §5): while `LOST_SALES_WRITES_PAUSED=true`, every request that
 * adds, changes or deletes a lost sale answers 503 "back in a few minutes". Reads and every other area carry on.
 * Same idea as deliveriesWritesPause.ts: one stray save mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/lost-sales'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const lostSalesWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.LOST_SALES_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isLostSaleWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const LOST_SALES_PAUSED_MESSAGE = 'Lost Sales is being updated and will be back in a few minutes. Please try again shortly.';

export function lostSalesWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (lostSalesWritesPaused() && isLostSaleWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: LOST_SALES_PAUSED_MESSAGE, paused: true });
  }
  next();
}
