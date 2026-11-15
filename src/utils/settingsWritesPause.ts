/**
 * The Settings cutover pause (DB_MOVE_CHECKLIST.md §5): while `SETTINGS_WRITES_PAUSED=true`, every request that
 * saves or clears a setting (the side nav order) answers 503 "back in a few minutes". Reads and every other area carry on.
 * Same idea as deliveriesWritesPause.ts: one stray save mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/nav-order'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const settingsWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.SETTINGS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isSettingsWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const SETTINGS_PAUSED_MESSAGE = 'Settings are being updated and will be back in a few minutes. Please try again shortly.';

export function settingsWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (settingsWritesPaused() && isSettingsWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: SETTINGS_PAUSED_MESSAGE, paused: true });
  }
  next();
}
