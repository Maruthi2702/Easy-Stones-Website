/**
 * Lambda → Render: `POST /api/internal/relay`. Lambda has no Socket.IO server and
 * no in-memory caches of its own, so the emits and cache busts a request makes
 * there are queued and posted here, and Render runs them on its own `io` and
 * caches. Contract: src/lambda/README.md, "Lambda → Render".
 *
 *   app.use('/api', createSocketRelayRouter({ secret: process.env.RELAY_SECRET, io, bust }))
 *
 * Mounted before the global express.json (it parses its own body, ≤ 1 MB), the
 * /api rate limiter and auth; the forwarder never sends this path to Lambda.
 * Server-only.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

export const RELAY_PATH = '/internal/relay';
export const RELAY_BODY_LIMIT = '1mb';

export type RelayEmitter = { emit: (event: string, ...args: unknown[]) => unknown };
export type RelayIo = RelayEmitter & { to: (rooms: string | string[]) => RelayEmitter };

export type RelayCacheName = 'customers' | 'users' | 'products';
export const RELAY_CACHES: readonly RelayCacheName[] = ['customers', 'users', 'products'];

export type RelayLog = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

export type SocketRelayOptions = {
  /** RELAY_SECRET; unset or empty = the route answers 404. */
  secret: string | null | undefined;
  io: RelayIo;
  bust: Record<RelayCacheName, () => void>;
  log?: RelayLog;
};

export type RelayEmit = { type: 'emit'; rooms: string[]; event: string; args: unknown[] };
export type RelayBust = { type: 'bust'; caches: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

/** Equal secrets, in constant time whatever their lengths (both hashed first). */
export function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A message's own problem, or null when it can run. Unknown types and bad fields
 * are skipped (and logged), never guessed at.
 */
export function messageProblem(message: Record<string, unknown>): string | null {
  if (message.type === 'emit') {
    if (typeof message.event !== 'string' || !message.event) return 'emit without an event name';
    if (!isStringArray(message.rooms)) return `emit "${message.event}": rooms must be a list of room names`;
    if (!Array.isArray(message.args)) return `emit "${message.event}": args must be a list`;
    return null;
  }
  if (message.type === 'bust') {
    if (!Array.isArray(message.caches) || !message.caches.every((c) => typeof c === 'string')) return 'bust: caches must be a list of names';
    return null;
  }
  return `unknown message type ${JSON.stringify(message.type)}`;
}

export function createSocketRelayRouter({ secret, io, bust, log = console }: SocketRelayOptions): Router {
  const router = express.Router();
  const expected = String(secret ?? '');

  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (!expected) return res.status(404).json({ error: 'Not found.' });
    if (!secretMatches(req.headers['x-relay-secret'], expected)) return res.status(403).json({ error: 'Forbidden.' });
    return next();
  };

  const run = (req: Request, res: Response) => {
    const body: unknown = req.body;
    if (!isObject(body) || !Array.isArray(body.messages) || !body.messages.every(isObject)
      || (body.from !== undefined && typeof body.from !== 'string')) {
      return res.status(400).json({ error: 'Expected { from, messages: [...] }.' });
    }
    const from = typeof body.from === 'string' ? body.from : 'unknown';
    for (const message of body.messages as Record<string, unknown>[]) {
      const problem = messageProblem(message);
      if (problem) { log.warn(`[relay] from ${from}: skipped — ${problem}`); continue; }
      try {
        if (message.type === 'emit') {
          const { rooms, event, args } = message as unknown as RelayEmit;
          if (rooms.length === 0) io.emit(event, ...args);
          else io.to(rooms).emit(event, ...args);
        } else {
          const { caches } = message as unknown as RelayBust;
          for (const name of new Set(caches)) {
            if ((RELAY_CACHES as readonly string[]).includes(name)) bust[name as RelayCacheName]();
            else log.warn(`[relay] from ${from}: unknown cache ${JSON.stringify(name)} ignored`);
          }
        }
      } catch (err) {
        log.error(`[relay] from ${from}: ${String(message.type)} failed:`, err instanceof Error ? err.message : err);
      }
    }
    return res.status(204).end();
  };

  // Body errors (bad JSON, too big) from this route's own parser.
  const bodyError = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = isObject(err) && err.type === 'entity.too.large' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'Relay body over 1 MB.' : 'Malformed relay body.' });
  };

  router.post(RELAY_PATH, guard, express.json({ limit: RELAY_BODY_LIMIT }), run, bodyError);
  return router;
}
