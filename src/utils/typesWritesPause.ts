/**
 * The type lists' cutover pause (DB_MOVE_CHECKLIST.md §5): while `TYPES_WRITES_PAUSED=true`, every request that adds,
 * renames, hides, reorders or deletes a visit type, resource type or family answers 503 "back in a few minutes".
 * Reads and every other area carry on. One stray save between the final sync and the switch would be lost.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/visit-types', '/api/resource-types', '/api/resource-families'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const typesWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.TYPES_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isTypesWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const TYPES_PAUSED_MESSAGE = 'The type lists are being updated and will be back in a few minutes. Please try again shortly.';

export function typesWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (typesWritesPaused() && isTypesWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: TYPES_PAUSED_MESSAGE, paused: true });
  }
  next();
}
