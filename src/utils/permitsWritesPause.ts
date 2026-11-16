/**
 * The cutover pause for Permits (docs/db/permits-plan.md): while `PERMITS_WRITES_PAUSED=true`, every write under
 * `/api/permits` (Refresh included) answers 503 "back in a few minutes", and the server does not start the morning pull
 * (`permitsWritesPaused()` is checked where server.ts starts it; changing the setting restarts the server). Reads carry on.
 * Same idea as smallWritesPause.ts: one stray save or pull mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/permits'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const permitsWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.PERMITS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isPermitsWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const PERMITS_PAUSED_MESSAGE = 'This is being updated and will be back in a few minutes. Please try again shortly.';

export function permitsWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (permitsWritesPaused() && isPermitsWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: PERMITS_PAUSED_MESSAGE, success: false, paused: true });
  }
  next();
}

/** Pulls (runs) that started and never finished: the cutover refuses to copy while one is open, or its rows would be half. */
export function openPermitRuns(runs: { _id?: unknown; source?: unknown; finishedAt?: unknown }[]): string[] {
  return runs.filter(r => r.finishedAt == null).map(r => `${String(r.source ?? '?')} (${String(r._id)})`);
}
