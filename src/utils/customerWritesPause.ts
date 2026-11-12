/**
 * The cutover pause (DB_MOVE_CHECKLIST.md §4): while `CUSTOMER_WRITES_PAUSED=true`, every request that
 * would change the customer area answers 503 "back in a few minutes" instead. Reads, everything else
 * (check-ins, deliveries, payments, the daily report…) and sign-in for staff carry on.
 *
 * Why a switch and not "please stop": one forgotten tab saving a visit while the copy runs would make
 * MongoDB and Postgres differ and spoil the check. It is read on every request, so it takes effect as
 * soon as the service restarts with it set, and the same restart can drop it again.
 */
import type { Request, Response, NextFunction } from 'express';

/** What counts as the customer area: its own routes (and the old addresses that still answer), website
 *  customers' sign-up and sign-in (which write login state onto the customer) and the calendar syncs (which write schedules). */
const PAUSED_PREFIXES = [
  '/api/customers', '/api/partners', '/api/sales/customers', '/api/admin/customers',
  '/api/schedule', '/api/admin/schedule',
  '/api/customer/register', '/api/customer/login',
  '/api/auth/google/calendar/sync', '/api/auth/icloud/sync'
];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const customerWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.CUSTOMER_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

/** Would this request change the customer area? */
export function isCustomerWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const PAUSED_MESSAGE = 'Customer records are being updated and will be back in a few minutes. Please try again shortly.';

export function customerWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (customerWritesPaused() && isCustomerWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: PAUSED_MESSAGE, paused: true });
  }
  next();
}
