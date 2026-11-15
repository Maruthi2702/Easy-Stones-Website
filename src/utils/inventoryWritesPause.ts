/**
 * The Inventory cutover pause (DB_MOVE_CHECKLIST.md §5): while `INVENTORY_WRITES_PAUSED=true`, every request that
 * imports stock / sales / in-transit reports or changes Purchasing answers 503 "back in a few minutes". Reads and
 * every other area carry on. One switch (`DB_INVENTORY`) covers stock, in-transit and Purchasing, so one pause does too.
 * Same idea as lostSalesWritesPause.ts: one stray import mid-copy would spoil the check.
 */
import type { Request, Response, NextFunction } from 'express';

const PAUSED_PREFIXES = ['/api/inventory-analysis', '/api/purchasing'];
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const inventoryWritesPaused = (env: NodeJS.ProcessEnv = process.env) => String(env.INVENTORY_WRITES_PAUSED || '').trim().toLowerCase() === 'true';

export function isInventoryWrite(method: string, path: string): boolean {
  if (READS.has(method.toUpperCase())) return false;
  const p = path.split('?')[0].replace(/\/+$/, '');
  return PAUSED_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`));
}

export const INVENTORY_PAUSED_MESSAGE = 'Inventory is being updated and will be back in a few minutes. Please try again shortly.';

export function inventoryWritesPauseGate(req: Request, res: Response, next: NextFunction) {
  if (inventoryWritesPaused() && isInventoryWrite(req.method, req.originalUrl || req.url)) {
    res.set('Retry-After', '120');
    return res.status(503).json({ message: INVENTORY_PAUSED_MESSAGE, paused: true });
  }
  next();
}
