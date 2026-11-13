/**
 * The deliveries cutover pause (DB_MOVE_CHECKLIST.md §5): while `DELIVERIES_WRITES_PAUSED=true`, every request
 * that changes a delivery ticket or a truck answers 503 "back in a few minutes". Reads and every other area carry on.
 * Same idea as the customer pause (customerWritesPause.ts): one stray save mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/deliveries', '/api/trucks'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const deliveriesWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.DELIVERIES_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isDeliveryWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const DELIVERIES_PAUSED_MESSAGE = 'The Delivery Schedule is being updated and will be back in a few minutes. Please try again shortly.';

export function deliveriesWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (deliveriesWritesPaused() && isDeliveryWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: DELIVERIES_PAUSED_MESSAGE, paused: true });
  }
  next();
}
