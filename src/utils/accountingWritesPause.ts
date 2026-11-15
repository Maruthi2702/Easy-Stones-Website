/**
 * The Accounting (3rd-party freight) cutover pause (DB_MOVE_CHECKLIST.md §5): while `ACCOUNTING_WRITES_PAUSED=true`,
 * every request that changes a carrier, charge, invoice or payment answers 503 "back in a few minutes", and the
 * freight sync (after a delivery save, and the 10-minute catch-up) waits. Reads carry on, and Fuel Man has its own pause.
 * One stray payment mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PREFIX = '/api/accounting';
const FUEL_MAN = `${PREFIX}/fuel-man`;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const accountingWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.ACCOUNTING_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isAccountingWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  if (p === FUEL_MAN || p.startsWith(`${FUEL_MAN}/`)) return false;
  return p === PREFIX || p.startsWith(`${PREFIX}/`);
}

export const ACCOUNTING_PAUSED_MESSAGE = 'Freight accounting is being updated and will be back in a few minutes. Please try again shortly.';

export function accountingWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (accountingWritesPaused() && isAccountingWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: ACCOUNTING_PAUSED_MESSAGE, paused: true });
  }
  next();
}
