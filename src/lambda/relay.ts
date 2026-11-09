/**
 * Socket emits and cache busts on Lambda (src/lambda/README.md, "Lambda → Render").
 *
 * Lambda has no Socket.IO server and no in-memory caches, so server.ts sets
 * `app.set('io', relay.io)` there: the routes' `io.emit(…)` / `io.to(room).emit(…)`
 * queue messages here, and the handler sends them to Render's
 * `POST /api/internal/relay` (src/server/socketRelay.ts) before it returns — a
 * frozen Lambda would drop anything still waiting. Sending never throws: an answer
 * that has been worked out is never lost because Render didn't take its live update.
 */
import type { RelayBust, RelayCacheName, RelayEmit } from '../server/socketRelay.ts';

export type RelayMessage = RelayEmit | RelayBust;

/** What routes use of Socket.IO's server: `emit`, `to` / `in` (chainable). */
export type RelayOperator = {
  emit: (event: string, ...args: unknown[]) => boolean;
  to: (room: string | string[]) => RelayOperator;
  in: (room: string | string[]) => RelayOperator;
};

type RelayOptions = {
  url?: () => string | undefined;
  secret?: () => string | undefined;
  from?: () => string;
  fetchImpl?: typeof fetch;
  log?: Pick<Console, 'warn' | 'error'>;
  timeoutMs?: number;
  /** Render refuses a body over 1 MB (RELAY_BODY_LIMIT); a little under it. */
  maxBodyBytes?: number;
};

// Socket.IO turns an emit's arguments into JSON-like data when it's called; copy
// them now so a document changed after the emit still sends what was emitted.
const snapshot = (args: unknown[]): unknown[] => JSON.parse(JSON.stringify(args));

const roomList = (rooms: string | string[]): string[] => (Array.isArray(rooms) ? rooms : [rooms]).map(String).filter(Boolean);

export function createRelay({
  url = () => process.env.RELAY_URL,
  secret = () => process.env.RELAY_SECRET,
  from = () => `lambda:${process.env.MODULE || 'api'}`,
  fetchImpl = (...a) => globalThis.fetch(...a),
  log = console,
  timeoutMs = 5000,
  maxBodyBytes = 1_000_000 - 4096
}: RelayOptions = {}) {
  let queue: RelayMessage[] = [];
  let warnedUnset = false;

  const operator = (rooms: string[]): RelayOperator => ({
    emit(event, ...args) {
      try {
        queue.push({ type: 'emit', rooms: [...new Set(rooms)], event: String(event), args: snapshot(args) });
      } catch (err) {
        log.error(`[relay] "${event}" not sent: its data can't be sent as JSON —`, (err as Error)?.message || err);
      }
      return true;
    },
    to: (more) => operator([...rooms, ...roomList(more)]),
    in: (more) => operator([...rooms, ...roomList(more)])
  });

  /** Socket.IO's server, as far as the routes use it. `rooms: []` = everyone. */
  const io: RelayOperator = operator([]);

  /** Render empties these caches of its own (bustCustomerCaches / bustUserCaches / bustProductCache). */
  function bust(...caches: RelayCacheName[]) {
    queue.push({ type: 'bust', caches });
  }

  const pending = (): readonly RelayMessage[] => queue;

  /** Bodies under the size Render takes; one message bigger than that alone is dropped (logged). */
  function batches(messages: RelayMessage[]): RelayMessage[][] {
    const out: RelayMessage[][] = [];
    let current: RelayMessage[] = [];
    let size = 0;
    const overhead = JSON.stringify({ from: from(), messages: [] }).length;
    for (const m of messages) {
      const bytes = Buffer.byteLength(JSON.stringify(m)) + 1;
      if (bytes + overhead > maxBodyBytes) {
        log.error(`[relay] dropped ${m.type === 'emit' ? `"${m.event}"` : 'a bust'}: ${bytes} bytes is more than Render takes`);
        continue;
      }
      if (current.length && size + bytes + overhead > maxBodyBytes) { out.push(current); current = []; size = 0; }
      current.push(m);
      size += bytes;
    }
    if (current.length) out.push(current);
    return out;
  }

  /** Busts are merged into one message (a write busts the same caches once per route). */
  function merged(messages: RelayMessage[]): RelayMessage[] {
    const caches = new Set<string>();
    const emits = messages.filter((m): m is RelayEmit => {
      if (m.type === 'bust') { m.caches.forEach((c) => caches.add(c)); return false; }
      return true;
    });
    return caches.size ? [{ type: 'bust', caches: [...caches] }, ...emits] : emits;
  }

  /** Send what's queued. Resolves once Render answered (or didn't); never rejects. */
  async function flush(): Promise<void> {
    if (!queue.length) return;
    const messages = merged(queue);
    queue = [];
    const target = url();
    const key = secret();
    if (!target || !key) {
      if (!warnedUnset) log.warn(`[relay] RELAY_URL / RELAY_SECRET not set: ${messages.length} live update(s) not sent to Render`);
      warnedUnset = true;
      return;
    }
    for (const group of batches(messages)) {
      try {
        const res = await fetchImpl(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-relay-secret': key },
          body: JSON.stringify({ from: from(), messages: group }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!res.ok) log.error(`[relay] Render answered ${res.status}: ${group.length} live update(s) lost`);
      } catch (err) {
        log.error(`[relay] could not reach Render: ${group.length} live update(s) lost —`, (err as Error)?.message || err);
      }
    }
  }

  return { io, bust, flush, pending };
}

/** The one relay a Lambda instance uses (server.ts and handler.ts). */
export const relay = createRelay();
export const flushRelay = () => relay.flush();
