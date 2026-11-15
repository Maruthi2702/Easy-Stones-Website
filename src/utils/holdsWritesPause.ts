/**
 * The Cart & Holds cutover pause (DB_MOVE_CHECKLIST.md §5): while `HOLDS_WRITES_PAUSED=true`, every request that
 * changes a cart or a hold answers 503 "back in a few minutes", and the hold expiry job waits. Reads, the slab
 * status lookup (a POST that only reads) and every other area carry on. Same idea as inventoryWritesPause.ts:
 * one stray hold mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PREFIX = '/api/holds';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** POSTs that only look things up. */
const LOOKUPS = new Set([`${PREFIX}/slabs/status`]);

export const holdsWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.HOLDS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isHoldsWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  if (LOOKUPS.has(p)) return false;
  return p === PREFIX || p.startsWith(`${PREFIX}/`);
}

export const HOLDS_PAUSED_MESSAGE = 'Carts and holds are being updated and will be back in a few minutes. Please try again shortly.';

export function holdsWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (holdsWritesPaused() && isHoldsWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: HOLDS_PAUSED_MESSAGE, paused: true });
  }
  next();
}
