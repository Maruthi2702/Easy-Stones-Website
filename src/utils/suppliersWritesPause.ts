/**
 * The Supplier POs / supplier portal cutover pause (DB_MOVE_CHECKLIST.md §5): while `SUPPLIERS_WRITES_PAUSED=true`,
 * every request that changes anything under `/api/suppliers` (staff) or `/api/supplier-portal` (the suppliers'
 * own side, sign-in included) answers 503 "back in a few minutes", and a signed-in supplier's "last seen" is
 * not written. Reads, signing out, and a photo upload that touches no record (the photo is stored, nothing
 * else) carry on, as does every other area. One stray write mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PREFIXES = ['/api/suppliers', '/api/supplier-portal'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** POSTs that change no supplier record. */
const LOOKUPS = new Set(['/api/supplier-portal/sign-out', '/api/suppliers/block-photos']);

export const suppliersWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.SUPPLIERS_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isSuppliersWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  if (LOOKUPS.has(p)) return false;
  return PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const SUPPLIERS_PAUSED_MESSAGE = 'Supplier POs are being updated and will be back in a few minutes. Please try again shortly.';

export function suppliersWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (suppliersWritesPaused() && isSuppliersWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: SUPPLIERS_PAUSED_MESSAGE, paused: true });
  }
  next();
}
