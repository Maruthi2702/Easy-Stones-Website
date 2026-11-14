/**
 * The Daily Reports cutover pause (DB_MOVE_CHECKLIST.md §5): while `DAILY_REPORTS_WRITES_PAUSED=true`, every
 * request that changes a Daily Report answers 503 "back in a few minutes", and the 11:59 PM job skips its
 * pass (`autoSubmitDueDays` is not run; it catches up on the first tick after the pause, since every day it
 * files is derived from what is stored). Reads and every other area carry on.
 * `POST /api/deliveries/arrivals` is held too: logging an arrival adds a line to submitted reports.
 * So are Payments and Check In (+ Selection Sheet): they move in the same window (the operations copy,
 * `--scope operations`), and the report is derived from them.
 * Same idea as deliveriesWritesPause.ts: one stray save mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/daily-reports', '/api/deliveries/arrivals', '/api/payments-received', '/api/checkin'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const dailyReportsWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.DAILY_REPORTS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isDailyReportWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const DAILY_REPORTS_PAUSED_MESSAGE = 'Payments, Check In and the Daily Report are being updated and will be back in a few minutes. Please try again shortly.';

export function dailyReportsWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (dailyReportsWritesPaused() && isDailyReportWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: DAILY_REPORTS_PAUSED_MESSAGE, paused: true });
  }
  next();
}
