import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createSocketRelayRouter, messageProblem, secretMatches } from './socketRelay.ts';
import type { RelayIo } from './socketRelay.ts';

function fakeIo() {
  const calls: Array<{ rooms: string | string[] | null; event: string; args: unknown[] }> = [];
  const io: RelayIo = {
    emit: (event, ...args) => { calls.push({ rooms: null, event, args }); return true; },
    to: (rooms) => ({ emit: (event, ...args) => { calls.push({ rooms, event, args }); return true; } })
  };
  return { io, calls };
}

function setup(secret: string | null = 'relay-key') {
  const { io, calls } = fakeIo();
  const bust = { customers: vi.fn(), users: vi.fn(), products: vi.fn() };
  const log = { warn: vi.fn(), error: vi.fn() };
  const app = express();
  app.use('/api', createSocketRelayRouter({ secret, io, bust, log }));
  // What sits behind the relay in server.ts: it must never be reached.
  const after = vi.fn((_req: express.Request, res: express.Response) => { res.status(418).end(); });
  app.use(after);
  return { app, calls, bust, log, after };
}

const post = (app: express.Express, body: unknown, secret: string | null = 'relay-key') => {
  const r = request(app).post('/api/internal/relay');
  if (secret !== null) r.set('x-relay-secret', secret);
  return r.send(body as object);
};

describe('secretMatches', () => {
  it('compares any lengths without throwing', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abcd', 'abc')).toBe(false);
    expect(secretMatches('', 'abc')).toBe(false);
    expect(secretMatches(undefined, 'abc')).toBe(false);
    expect(secretMatches(['abc'], 'abc')).toBe(false);
  });
});

describe('messageProblem', () => {
  it('accepts well-formed emit and bust messages', () => {
    expect(messageProblem({ type: 'emit', rooms: [], event: 'x', args: [] })).toBeNull();
    expect(messageProblem({ type: 'emit', rooms: ['a', 'b'], event: 'x', args: [1, { a: 2 }] })).toBeNull();
    expect(messageProblem({ type: 'bust', caches: ['customers'] })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(messageProblem({ type: 'emit', rooms: [], event: '', args: [] })).toMatch(/event/);
    expect(messageProblem({ type: 'emit', rooms: [], args: [] })).toMatch(/event/);
    expect(messageProblem({ type: 'emit', rooms: 'a', event: 'x', args: [] })).toMatch(/rooms/);
    expect(messageProblem({ type: 'emit', rooms: [1], event: 'x', args: [] })).toMatch(/rooms/);
    expect(messageProblem({ type: 'emit', rooms: [''], event: 'x', args: [] })).toMatch(/rooms/);
    expect(messageProblem({ type: 'emit', event: 'x', args: [] })).toMatch(/rooms/);
    expect(messageProblem({ type: 'emit', rooms: [], event: 'x', args: {} })).toMatch(/args/);
    expect(messageProblem({ type: 'emit', rooms: [], event: 'x' })).toMatch(/args/);
    expect(messageProblem({ type: 'bust', caches: 'customers' })).toMatch(/caches/);
    expect(messageProblem({ type: 'shout' })).toMatch(/unknown/);
  });
});

describe('POST /api/internal/relay', () => {
  it('answers 404 when Render has no secret set', async () => {
    for (const secret of [null, '']) {
      const { app, calls, after } = setup(secret);
      const res = await post(app, { messages: [{ type: 'emit', rooms: [], event: 'x', args: [] }] }, '');
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
      expect(after).not.toHaveBeenCalled();
    }
  });

  it('answers 403 on a missing or wrong secret, before reading the body', async () => {
    const { app, calls } = setup();
    expect((await post(app, { messages: [] }, null)).status).toBe(403);
    expect((await post(app, { messages: [] }, 'relay-ke')).status).toBe(403);
    expect((await post(app, { messages: [] }, 'relay-key-longer')).status).toBe(403);
    const bad = await request(app).post('/api/internal/relay').set('x-relay-secret', 'nope')
      .set('content-type', 'application/json').send('{not json');
    expect(bad.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('runs every message in order and answers 204', async () => {
    const { app, calls, bust } = setup();
    const res = await post(app, {
      from: 'lambda:permits',
      messages: [
        { type: 'emit', rooms: [], event: 'customer_update', args: [{ kind: 'visit' }] },
        { type: 'emit', rooms: ['location:Seattle'], event: 'delivery_update', args: [] },
        { type: 'bust', caches: ['customers', 'users', 'products', 'customers'] },
        { type: 'emit', rooms: ['a', 'b'], event: 'two', args: [1, 'x', null] }
      ]
    });
    expect(res.status).toBe(204);
    expect(calls).toEqual([
      { rooms: null, event: 'customer_update', args: [{ kind: 'visit' }] },
      { rooms: ['location:Seattle'], event: 'delivery_update', args: [] },
      { rooms: ['a', 'b'], event: 'two', args: [1, 'x', null] }
    ]);
    expect(bust.customers).toHaveBeenCalledTimes(1);
    expect(bust.users).toHaveBeenCalledTimes(1);
    expect(bust.products).toHaveBeenCalledTimes(1);
  });

  it('skips and logs unknown types, unknown caches and bad fields, running the rest', async () => {
    const { app, calls, bust, log } = setup();
    const res = await post(app, {
      messages: [
        { type: 'shout', event: 'x' },
        { type: 'emit', rooms: 'everyone', event: 'x', args: [] },
        { type: 'emit', rooms: [], event: 'kept', args: [] },
        { type: 'emit', rooms: [], args: [] },
        { type: 'bust', caches: ['customers', 'inventory'] }
      ]
    });
    expect(res.status).toBe(204);
    expect(calls).toEqual([{ rooms: null, event: 'kept', args: [] }]);
    expect(bust.customers).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(4);
  });

  it('keeps going when one emit throws', async () => {
    const { calls, log } = setup();
    let first = true;
    const io: RelayIo = {
      emit: (event) => { if (first) { first = false; throw new Error('boom'); } calls.push({ rooms: null, event, args: [] }); },
      to: () => ({ emit: () => true })
    };
    const app2 = express();
    app2.use('/api', createSocketRelayRouter({ secret: 'relay-key', io, bust: { customers() {}, users() {}, products() {} }, log }));
    const res = await post(app2, { messages: [{ type: 'emit', rooms: [], event: 'a', args: [] }, { type: 'emit', rooms: [], event: 'b', args: [] }] });
    expect(res.status).toBe(204);
    expect(calls.map((c) => c.event)).toEqual(['b']);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('answers 400 on a malformed body and runs nothing', async () => {
    const { app, calls } = setup();
    const bodies: unknown[] = [{}, { messages: 'x' }, { messages: [1] }, { messages: [{ type: 'emit', rooms: [], event: 'x', args: [] }, null] }, { from: 3, messages: [] }, [{ type: 'emit' }]];
    for (const body of bodies) expect((await post(app, body)).status).toBe(400);
    const notJson = await request(app).post('/api/internal/relay').set('x-relay-secret', 'relay-key')
      .set('content-type', 'application/json').send('{"messages": [');
    expect(notJson.status).toBe(400);
    const text = await request(app).post('/api/internal/relay').set('x-relay-secret', 'relay-key')
      .set('content-type', 'text/plain').send('hello');
    expect(text.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses a body over 1 MB', async () => {
    const { app, calls } = setup();
    const res = await post(app, { messages: [{ type: 'emit', rooms: [], event: 'x', args: ['z'.repeat(1024 * 1024 + 10)] }] });
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('leaves other paths and methods alone', async () => {
    const { app, after } = setup();
    expect((await request(app).get('/api/internal/relay')).status).toBe(418);
    expect((await request(app).post('/api/internal/other').set('x-relay-secret', 'relay-key')).status).toBe(418);
    expect(after).toHaveBeenCalledTimes(2);
  });
});
