import { describe, expect, it, vi } from 'vitest';
import { createRelay } from './relay.ts';
import { messageProblem } from '../server/socketRelay.ts';
import type { RelayMessage } from './relay.ts';

const quiet = () => ({ warn: vi.fn(), error: vi.fn() });

function setup(overrides: Parameters<typeof createRelay>[0] = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const log = quiet();
  const relay = createRelay({ url: () => 'https://render.test/api/internal/relay', secret: () => 's3cret', from: () => 'lambda:permits', fetchImpl, log, ...overrides });
  const bodies = () => calls.map((c) => JSON.parse(String(c.init.body)) as { from: string; messages: RelayMessage[] });
  return { relay, calls, bodies, log, fetchImpl };
}

describe('relay', () => {
  it('queues emits in the contract format: rooms and args always lists', async () => {
    const { relay, bodies, calls } = setup();
    relay.io.emit('customer_update');
    relay.io.emit('customer_update', { kind: 'visit' });
    relay.io.to('location:Seattle').emit('delivery_update');
    relay.io.to(['a', 'b']).to('c').in('a').emit('x', 1, 'two');
    expect(relay.pending()).toHaveLength(4);
    await relay.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://render.test/api/internal/relay');
    expect((calls[0].init.headers as Record<string, string>)['x-relay-secret']).toBe('s3cret');
    const [{ from, messages }] = bodies();
    expect(from).toBe('lambda:permits');
    expect(messages).toEqual([
      { type: 'emit', rooms: [], event: 'customer_update', args: [] },
      { type: 'emit', rooms: [], event: 'customer_update', args: [{ kind: 'visit' }] },
      { type: 'emit', rooms: ['location:Seattle'], event: 'delivery_update', args: [] },
      { type: 'emit', rooms: ['a', 'b', 'c'], event: 'x', args: [1, 'two'] }
    ]);
    // Render's own check (src/server/socketRelay.ts) accepts every one.
    for (const m of messages) expect(messageProblem(m as unknown as Record<string, unknown>)).toBeNull();
    expect(relay.pending()).toHaveLength(0);
  });

  it('sends what was emitted, not what the object became later', async () => {
    const { relay, bodies } = setup();
    const doc = { status: 'old' };
    relay.io.emit('e', doc);
    doc.status = 'new';
    await relay.flush();
    expect(bodies()[0].messages[0]).toMatchObject({ args: [{ status: 'old' }] });
  });

  it('merges busts into one message', async () => {
    const { relay, bodies } = setup();
    relay.bust('customers');
    relay.io.emit('customer_update');
    relay.bust('customers', 'users');
    relay.bust('products');
    await relay.flush();
    const { messages } = bodies()[0];
    expect(messages[0]).toEqual({ type: 'bust', caches: ['customers', 'users', 'products'] });
    expect(messages.slice(1)).toEqual([{ type: 'emit', rooms: [], event: 'customer_update', args: [] }]);
    expect(messageProblem(messages[0] as unknown as Record<string, unknown>)).toBeNull();
  });

  it('does nothing with nothing queued', async () => {
    const { relay, calls } = setup();
    await relay.flush();
    expect(calls).toHaveLength(0);
  });

  it('resolves (and logs) when Render fails, refuses or is not set', async () => {
    const failing = setup({ fetchImpl: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
    failing.relay.io.emit('a');
    await expect(failing.relay.flush()).resolves.toBeUndefined();
    expect(failing.log.error).toHaveBeenCalled();

    const refused = setup({ fetchImpl: vi.fn(async () => new Response('no', { status: 403 })) as unknown as typeof fetch });
    refused.relay.io.emit('a');
    await expect(refused.relay.flush()).resolves.toBeUndefined();
    expect(refused.log.error).toHaveBeenCalledWith(expect.stringContaining('403'));

    const unset = setup({ url: () => undefined });
    unset.relay.io.emit('a');
    await unset.relay.flush();
    expect(unset.calls).toHaveLength(0);
    expect(unset.log.warn).toHaveBeenCalledTimes(1);
    expect(unset.relay.pending()).toHaveLength(0);
  });

  it('splits big batches under Render’s 1 MB and drops one message too big alone', async () => {
    const { relay, bodies, log } = setup({ maxBodyBytes: 2000 });
    for (let i = 0; i < 5; i++) relay.io.emit('e', 'x'.repeat(600));
    relay.io.emit('huge', 'y'.repeat(5000));
    await relay.flush();
    const sent = bodies();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.flatMap((b) => b.messages)).toHaveLength(5);
    for (const b of sent) expect(JSON.stringify(b).length).toBeLessThanOrEqual(2000);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"huge"'));
  });

  it('an emit whose data is not JSON is dropped, not thrown into the route', () => {
    const { relay, log } = setup();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(relay.io.emit('bad', loop)).toBe(true);
    expect(relay.pending()).toHaveLength(0);
    expect(log.error).toHaveBeenCalled();
  });
});
