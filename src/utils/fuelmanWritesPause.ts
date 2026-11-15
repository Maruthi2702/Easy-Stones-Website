/**
 * The Fuel Man cutover pause (DB_MOVE_CHECKLIST.md §5): while `FUELMAN_WRITES_PAUSED=true`, every request that
 * changes a statement, a driver match or a month answers 503 "back in a few minutes". Reads and every other
 * area carry on. Same idea as holdsWritesPause.ts: one stray write mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PREFIX = '/api/accounting/fuel-man';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Nothing Fuel Man POSTs only looks things up. */
const LOOKUPS = new Set<string>();

export const fuelmanWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.FUELMAN_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isFuelmanWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  if (LOOKUPS.has(p)) return false;
  return p === PREFIX || p.startsWith(`${PREFIX}/`);
}

export const FUELMAN_PAUSED_MESSAGE = 'Fuel Man is being updated and will be back in a few minutes. Please try again shortly.';

export function fuelmanWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (fuelmanWritesPaused() && isFuelmanWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: FUELMAN_PAUSED_MESSAGE, paused: true });
  }
  next();
}
