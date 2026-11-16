/**
 * The cutover pause for the small ones (DB_MOVE_CHECKLIST.md §5): while `SMALL_WRITES_PAUSED=true`, every write to the
 * products catalog, the Easy Stones colours, the Crossover Sheet, the contact form, Team Files and the old sales-resources
 * list answers 503 "back in a few minutes". Reads and every other area carry on. Same idea as settingsWritesPause.ts: one
 * stray save mid-copy would spoil the check. (A visitor who sends the contact form meanwhile is asked to try again.)
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = [
  '/api/contact', '/api/products/save', '/api/migrate-collection', '/api/crossover-sheet', '/api/easy-stones-colors',
  '/api/team-files', '/api/sales-dashboard', '/api/sales-resources'
];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const smallWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.SMALL_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isSmallWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const SMALL_PAUSED_MESSAGE = 'This is being updated and will be back in a few minutes. Please try again shortly.';

export function smallWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (smallWritesPaused() && isSmallWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: SMALL_PAUSED_MESSAGE, success: false, paused: true });
  }
  next();
}
