import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { gunzipSync } from 'node:zlib';
import { createHandler, applySecretEnv } from './handler.ts';
import { createRelay } from './relay.ts';
import type { HttpApiEvent } from './httpApi.ts';
import type { NodeApp } from './httpApi.ts';

const SECRET = 'forward-secret-for-tests';
const quiet = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function event(over: Partial<HttpApiEvent> & { method?: string; path?: string } = {}): HttpApiEvent {
  const { method = 'GET', path = '/api/test/json', ...rest } = over;
  return {
    version: '2.0',
    rawPath: path,
    rawQueryString: '',
    isBase64Encoded: false,
    ...rest,
    headers: { 'x-forward-secret': SECRET, 'x-forwarded-host': 'easy-stones.onrender.com', 'x-forwarded-proto': 'https', ...rest.headers },
    requestContext: { requestId: 'r1', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '52.10.20.30' } }
  };
}

const fetchCalls: unknown[] = [];
const relay = createRelay({
  url: () => 'https://render.test/api/internal/relay', secret: () => 'relay', from: () => 'lambda:test', log: quiet,
  fetchImpl: (async (_url: unknown, init: RequestInit) => {
    await new Promise((r) => setTimeout(r, 20));
    fetchCalls.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch
});

function testApp() {
  const app = express();
  app.set('trust proxy', 1); // as server.ts, on Render and on Lambda
  app.set('io', relay.io);
  app.use(compression());
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/test/json', (req, res) => {
    res.json({ query: req.query, ip: req.ip, ips: req.ips, host: req.get('host'), hostname: req.hostname, protocol: req.protocol, secure: req.secure, secretSeen: req.get('x-forward-secret') ?? null, url: req.originalUrl });
  });
  app.get('/api/test/pdf', (_req, res) => {
    res.type('application/pdf').send(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0x0d, 0x0a, 0x80]));
  });
  app.get('/api/test/cookies', (req, res) => {
    res.cookie('a', '1', { httpOnly: true });
    res.cookie('b', '2', { path: '/api/auth' });
    res.append('Set-Cookie', 'c=3; Path=/');
    res.json({ got: req.cookies });
  });
  app.get('/api/test/big-text', (_req, res) => { res.type('text/plain').send('hello '.repeat(2000)); });
  app.post('/api/test/echo', (req, res) => { res.status(201).json({ body: req.body, type: req.get('content-type') }); });
  app.post('/api/test/emit', (req, res) => {
    req.app.get('io').to('location:Seattle').emit('delivery_update', { id: 1 });
    res.on('finish', () => relay.bust('customers')); // as server.ts's cache-bust middleware
    res.status(204).end();
  });
  app.get('/api/test/stream', (_req, res) => { res.type('text/plain'); res.write('part1,'); setTimeout(() => res.end('part2'), 5); });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'No such endpoint' }); });
  return app as unknown as NodeApp;
}

const handlerFor = (app = testApp()) => createHandler({ loadSecrets: async () => {}, loadApp: async () => ({ app, ready: async () => {} }), flush: () => relay.flush(), log: quiet });

beforeEach(() => { process.env.FORWARD_SECRET = SECRET; fetchCalls.length = 0; });
afterEach(() => { delete process.env.FORWARD_SECRET; });

describe('Lambda handler', () => {
  it('answers 403 without the forward secret, or with a wrong one, or when none is configured', async () => {
    const handler = handlerFor();
    for (const headers of [{ 'x-forward-secret': '' }, { 'x-forward-secret': 'nope' }]) {
      const r = await handler(event({ headers }));
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: 'Forbidden' });
    }
    delete process.env.FORWARD_SECRET;
    expect((await handler(event())).statusCode).toBe(403);
  });

  it('runs a JSON route with its query string, and the app never sees the secret', async () => {
    const context: { callbackWaitsForEmptyEventLoop?: boolean } = {};
    const r = await handlerFor()(event({ rawQueryString: 'county=king&county=whatcom&q=a%20b' }), context);
    expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
    expect(r.statusCode).toBe(200);
    expect(r.isBase64Encoded).toBe(false);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(r.body);
    expect(body.query).toEqual({ county: ['king', 'whatcom'], q: 'a b' });
    expect(body.url).toBe('/api/test/json?county=king&county=whatcom&q=a%20b');
    expect(body.secretSeen).toBeNull();
  });

  it('gives req.ip, host and protocol as Render saw them', async () => {
    // Render: socket 10.0.0.9 (its own proxy), x-forwarded-for "1.1.1.1, 203.0.113.5"
    // (a spoofed entry, then the client) → req.ip 203.0.113.5. The forwarder appends
    // 10.0.0.9; API Gateway may append its caller (52.10.20.30).
    const r = await handlerFor()(event({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.5, 10.0.0.9, 52.10.20.30', host: 'abc.execute-api.us-east-2.amazonaws.com' } }));
    const body = JSON.parse(r.body);
    expect(body.ip).toBe('203.0.113.5');
    expect(body.host).toBe('easy-stones.onrender.com');
    expect(body.hostname).toBe('easy-stones.onrender.com');
    expect(body.protocol).toBe('https');
    expect(body.secure).toBe(true);

    // No header on Render: req.ip was Render's socket peer, the one entry sent.
    const alone = JSON.parse((await handlerFor()(event({ headers: { 'x-forwarded-for': '198.51.100.7' } }))).body);
    expect(alone.ip).toBe('198.51.100.7');
    const http = JSON.parse((await handlerFor()(event({ headers: { 'x-forwarded-proto': 'http' } }))).body);
    expect(http.protocol).toBe('http');
  });

  it('sends binary answers base64-encoded, byte for byte', async () => {
    const r = await handlerFor()(event({ path: '/api/test/pdf' }));
    expect(r.statusCode).toBe(200);
    expect(r.isBase64Encoded).toBe(true);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect([...Buffer.from(r.body, 'base64')]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0x0d, 0x0a, 0x80]);
  });

  it('a gzip-compressed answer comes back base64 with its content-encoding', async () => {
    const r = await handlerFor()(event({ path: '/api/test/big-text', headers: { 'accept-encoding': 'gzip' } }));
    expect(r.headers['content-encoding']).toBe('gzip');
    expect(r.isBase64Encoded).toBe(true);
    expect(gunzipSync(Buffer.from(r.body, 'base64')).toString()).toBe('hello '.repeat(2000));
    expect(r.headers['transfer-encoding']).toBeUndefined();
  });

  it('reads cookies in and keeps several set-cookie apart', async () => {
    const r = await handlerFor()(event({ path: '/api/test/cookies', cookies: ['token=abc', 'theme=dark'] }));
    expect(JSON.parse(r.body).got).toEqual({ token: 'abc', theme: 'dark' });
    expect(r.cookies).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/api/auth', 'c=3; Path=/']);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('parses a POST JSON body, plain or base64', async () => {
    const payload = JSON.stringify({ name: 'Zoë', n: 3 });
    for (const [body, isBase64Encoded] of [[payload, false], [Buffer.from(payload).toString('base64'), true]] as const) {
      const r = await handlerFor()(event({ method: 'POST', path: '/api/test/echo', body, isBase64Encoded, headers: { 'content-type': 'application/json' } }));
      expect(r.statusCode).toBe(201);
      expect(JSON.parse(r.body).body).toEqual({ name: 'Zoë', n: 3 });
    }
  });

  it('waits for an answer written in parts', async () => {
    const r = await handlerFor()(event({ path: '/api/test/stream' }));
    expect(r.body).toBe('part1,part2');
    expect(r.isBase64Encoded).toBe(false);
  });

  it('an answer with no content type is sent as base64 (never mangled)', async () => {
    const app = express();
    app.get('/api/test/raw', (_req, res) => { res.end(Buffer.from([0xc3, 0x28, 0x00])); });
    const r = await handlerFor(app as unknown as NodeApp)(event({ path: '/api/test/raw' }));
    expect(r.isBase64Encoded).toBe(true);
    expect([...Buffer.from(r.body, 'base64')]).toEqual([0xc3, 0x28, 0x00]);
  });

  it('a HEAD answer has headers and no body', async () => {
    const r = await handlerFor()(event({ method: 'HEAD' }));
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('');
    expect(r.headers['content-type']).toMatch(/json/);
  });

  it('sends the queued emits and busts (finish listeners included) before it returns', async () => {
    const r = await handlerFor()(event({ method: 'POST', path: '/api/test/emit' }));
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(fetchCalls).toEqual([{ from: 'lambda:test', messages: [
      { type: 'bust', caches: ['customers'] },
      { type: 'emit', rooms: ['location:Seattle'], event: 'delivery_update', args: [{ id: 1 }] }
    ] }]);
  });

  it('answers 503 when the secret or the database is not ready, and tries again next time', async () => {
    let fail = true;
    const handler = createHandler({
      loadSecrets: async () => { if (fail) throw new Error('no secret'); },
      loadApp: async () => ({ app: testApp(), ready: async () => {} }), flush: async () => {}, log: quiet
    });
    expect((await handler(event())).statusCode).toBe(503);
    fail = false;
    expect((await handler(event())).statusCode).toBe(200);

    let dbUp = false;
    const noDb = createHandler({ loadSecrets: async () => {}, loadApp: async () => ({ app: testApp(), ready: async () => { if (!dbUp) throw new Error('no db'); } }), flush: async () => {}, log: quiet });
    expect((await noDb(event())).statusCode).toBe(503);
    dbUp = true;
    expect((await noDb(event())).statusCode).toBe(200);
  });

  it('an answer over 6 MB becomes a 502 that says why', async () => {
    const app = express();
    app.get('/api/test/huge', (_req, res) => { res.type('application/octet-stream').send(Buffer.alloc(5 * 1024 * 1024, 1)); });
    const r = await handlerFor(app as unknown as NodeApp)(event({ path: '/api/test/huge' }));
    expect(r.statusCode).toBe(502);
    expect(JSON.parse(r.body).error).toMatch(/too big/);
  });
});

describe('applySecretEnv', () => {
  it('sets the app settings but never what Lambda owns', () => {
    const env: NodeJS.ProcessEnv = { RUNTIME: 'lambda', MODULE: 'permits', AWS_ACCESS_KEY_ID: 'role-key', AWS_SESSION_TOKEN: 'tok' };
    const set = applySecretEnv(JSON.stringify({ MONGO_URI: 'mongodb://x', JWT_SECRET: 'j', PORT: 3001, RUNTIME: 'render', MODULE: 'x', AWS_ACCESS_KEY_ID: 'render-key', nested: { a: 1 } }), env, quiet);
    expect(set.sort()).toEqual(['JWT_SECRET', 'MONGO_URI', 'PORT']);
    expect(env).toMatchObject({ MONGO_URI: 'mongodb://x', PORT: '3001', RUNTIME: 'lambda', MODULE: 'permits', AWS_ACCESS_KEY_ID: 'role-key', AWS_SESSION_TOKEN: 'tok' });
    expect(() => applySecretEnv('[]', {}, quiet)).toThrow(/JSON object/);
  });
});
