/**
 * The Users / Roles / Locations cutover pause (DB_MOVE_CHECKLIST.md §5): while `STAFF_WRITES_PAUSED=true`,
 * every request that saves a user, role or location, sets or changes a password, saves a person's own
 * pins / filters / calendar links, or arranges a branch's delivery columns answers 503 "back in a few minutes".
 * Reads, signing in and every other area carry on (sign-in only moves counters and "last seen", which the staff
 * check ignores). Same idea as settingsWritesPause.ts: one stray save between the final sync and the switch would be lost.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = [
  '/api/admin/users', '/api/admin/roles', '/api/admin/locations',
  '/api/auth/first-password', '/api/auth/accept-invite', '/api/auth/change-password',
  '/api/user/me/route-planner-filters', '/api/user/me/pinned-tabs',
  '/api/auth/google', '/api/auth/icloud', '/api/calendar/subscription',
  '/api/delivery-columns'
];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const staffWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.STAFF_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isStaffWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const STAFF_PAUSED_MESSAGE = 'Users, roles and locations are being updated and will be back in a few minutes. Please try again shortly.';

export function staffWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (staffWritesPaused() && isStaffWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: STAFF_PAUSED_MESSAGE, paused: true });
  }
  next();
}
