import http from 'node:http';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BUSY_MESSAGE, appendForwardedFor, createLambdaForward, forwardableBody, parseLambdaRoutes,
  shouldForward, splitRenderForwardedFor
} from './lambdaForward.ts';
import type { LambdaForwardOptions } from './lambdaForward.ts';

// ── pure rules ──────────────────────────────────────────────────────────────

describe('parseLambdaRoutes', () => {
  it('reads prefixes and ! exclusions, trimming blanks and trailing slashes', () => {
    expect(parseLambdaRoutes(' /api/permits , !/api/permits/refresh ,, /api/holds/ ')).toEqual({
      include: ['/api/permits', '/api/holds'], exclude: ['/api/permits/refresh'], invalid: []
    });
  });

  it('is empty for an empty or missing spec, and sets aside entries that are not paths', () => {
    expect(parseLambdaRoutes('')).toEqual({ include: [], exclude: [], invalid: [] });
    expect(parseLambdaRoutes(undefined)).toEqual({ include: [], exclude: [], invalid: [] });
    expect(parseLambdaRoutes('api/permits,!x')).toEqual({ include: [], exclude: [], invalid: ['api/permits', '!x'] });
  });
});

describe('shouldForward', () => {
  const routes = parseLambdaRoutes('/api/permits,!/api/permits/refresh');

  it('matches the prefix itself or below it, never a longer name', () => {
    expect(shouldForward('/api/permits', routes)).toBe(true);
    expect(shouldForward('/api/permits/', routes)).toBe(true);
    expect(shouldForward('/api/permits/list', routes)).toBe(true);
    expect(shouldForward('/api/permits?county=king', routes)).toBe(true);
    expect(shouldForward('/api/permitsx', routes)).toBe(false);
    expect(shouldForward('/api/permit', routes)).toBe(false);
    expect(shouldForward('/api/customers', routes)).toBe(false);
  });

  it('lets exclusions win, on the path only', () => {
    expect(shouldForward('/api/permits/refresh', routes)).toBe(false);
    expect(shouldForward('/api/permits/refresh/now', routes)).toBe(false);
    expect(shouldForward('/api/permits/refresh?x=1', routes)).toBe(false);
    expect(shouldForward('/api/permits/refreshed', routes)).toBe(true);
    expect(shouldForward('/api/permits?next=/api/permits/refresh', routes)).toBe(true);
  });

  it('is case-sensitive and decodes nothing', () => {
    expect(shouldForward('/API/permits', routes)).toBe(false);
    expect(shouldForward('/api/%70ermits', routes)).toBe(false);
  });

  it('forwards nothing for an empty spec, and never the relay', () => {
    expect(shouldForward('/api/permits', parseLambdaRoutes(''))).toBe(false);
    const all = parseLambdaRoutes('/api');
    expect(shouldForward('/api/anything', all)).toBe(true);
    expect(shouldForward('/api/internal/relay', all)).toBe(false);
  });
});

describe('forwardableBody', () => {
  it('takes no body or a known length up to the limit', () => {
    expect(forwardableBody({})).toBe(true);
    expect(forwardableBody({ 'content-length': '0' })).toBe(true);
    expect(forwardableBody({ 'content-length': String(5 * 1024 * 1024) })).toBe(true);
    expect(forwardableBody({ 'content-length': String(5 * 1024 * 1024 + 1) })).toBe(false);
    expect(forwardableBody({ 'transfer-encoding': 'chunked' })).toBe(false);
    expect(forwardableBody({ 'content-length': 'abc' })).toBe(false);
  });
});

describe('x-forwarded-for', () => {
  it('appends the socket address', () => {
    expect(appendForwardedFor(undefined, '10.0.0.5')).toBe('10.0.0.5');
    expect(appendForwardedFor('1.1.1.1', '10.0.0.5')).toBe('1.1.1.1, 10.0.0.5');
    expect(appendForwardedFor(['1.1.1.1', '2.2.2.2'], '10.0.0.5')).toBe('1.1.1.1, 2.2.2.2, 10.0.0.5');
  });

  it('splits Render’s view back out, dropping an API Gateway source address after it', () => {
    expect(splitRenderForwardedFor('1.1.1.1, 10.0.0.5')).toEqual({ remoteAddress: '10.0.0.5', forwardedFor: '1.1.1.1' });
    expect(splitRenderForwardedFor('1.1.1.1, 10.0.0.5, 3.3.3.3', '3.3.3.3')).toEqual({ remoteAddress: '10.0.0.5', forwardedFor: '1.1.1.1' });
    expect(splitRenderForwardedFor('10.0.0.5')).toEqual({ remoteAddress: '10.0.0.5', forwardedFor: undefined });
    expect(splitRenderForwardedFor('10.0.0.5', '10.0.0.5')).toEqual({ remoteAddress: '10.0.0.5', forwardedFor: undefined });
  });
});

// ── against a real upstream ─────────────────────────────────────────────────

type UpstreamHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void;
type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

let upstreamHandler: UpstreamHandler;
let seen: Seen[] = [];
let upstreamClosed: Array<() => void> = [];
const upstream = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  // The connection went away before this answer finished: the forwarder dropped the call.
  res.on('close', () => { if (!res.writableFinished) upstreamClosed.forEach((f) => f()); });
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    upstreamHandler(req, res, body);
  });
});
let upstreamUrl = '';
let deadUrl = '';
const servers: http.Server[] = [];

const listen = (server: http.Server) => new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
});

beforeAll(async () => {
  upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`;
  // A port that was open a moment ago and isn't now: connection refused.
  const gone = http.createServer();
  const port = await listen(gone);
  await new Promise<void>((r) => gone.close(() => r()));
  deadUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
});

afterEach(async () => {
  seen = [];
  upstreamClosed = [];
  upstreamHandler = (_req, res) => { res.end('ok'); };
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

const quietLog = () => ({ warn: vi.fn(), error: vi.fn() });

/** Render stand-in: the forwarder, then the parsers it must run ahead of, then a local route. */
async function render(options: Partial<LambdaForwardOptions> = {}, extra?: (app: express.Express) => void) {
  const app = express();
  app.set('trust proxy', 1);
  extra?.(app);
  app.use(createLambdaForward({
    apiUrl: upstreamUrl, routes: '/api/permits,!/api/permits/refresh', secret: 's3cret', log: quietLog(), ...options
  }));
  app.use(express.json());
  app.use((req, res) => { res.status(200).json({ local: true, path: req.originalUrl, body: req.body ?? null }); });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(500).json({ localError: err.message }); });
  const server = http.createServer(app);
  servers.push(server);
  return `http://127.0.0.1:${await listen(server)}`;
}

/** A raw request, so Host and hop-by-hop headers can be set and bytes read untouched. */
function raw(url: string, opts: { method?: string; path: string; headers?: http.OutgoingHttpHeaders; body?: Buffer | string; chunked?: boolean }) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; rawHeaders: string[]; body: Buffer }>((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, rawHeaders: res.rawHeaders, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (opts.chunked && opts.body !== undefined) { req.write(opts.body); req.end(); } else req.end(opts.body);
  });
}

describe('createLambdaForward', () => {
  it('does nothing without a URL or routes', async () => {
    for (const options of [{ apiUrl: '' }, { routes: '' }, { apiUrl: undefined }, { routes: '!/api/permits/refresh' }]) {
      const base = await render(options);
      const res = await fetch(`${base}/api/permits/list`);
      expect(await res.json()).toEqual({ local: true, path: '/api/permits/list', body: null });
    }
    expect(seen).toHaveLength(0);
  });

  it('sends the method, path and query exactly as received, under the base path', async () => {
    upstreamHandler = (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ from: 'lambda', url: req.url })); };
    const base = await render({ apiUrl: `${upstreamUrl}/prod/` });
    const res = await fetch(`${base}/api/permits/list?county=king&q=a%20b&q=c+d&x[]=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: 'lambda', url: '/prod/api/permits/list?county=king&q=a%20b&q=c+d&x[]=1' });
    expect(seen[0].method).toBe('GET');
  });

  it('copies headers minus hop-by-hop and host, and adds the forwarding ones', async () => {
    const base = await render();
    await raw(base, {
      path: '/api/permits/x',
      headers: {
        host: 'easystones.example', 'x-forwarded-for': '1.1.1.1, 9.9.9.9', 'x-forwarded-proto': 'https',
        connection: 'keep-alive, x-drop-me', 'keep-alive': 'timeout=5', te: 'trailers', 'x-drop-me': '1',
        'proxy-authorization': 'Basic x', upgrade: 'h2c', cookie: 'token=abc', authorization: 'Bearer t', 'x-custom': 'kept',
        'accept-encoding': 'gzip', 'x-forward-secret': 'from-the-client'
      }
    });
    const h = seen[0].headers;
    expect(h.host).toBe(new URL(upstreamUrl).host);
    expect(h['x-forwarded-host']).toBe('easystones.example');
    expect(h['x-forwarded-proto']).toBe('https');
    expect(h['x-forwarded-for']).toBe('1.1.1.1, 9.9.9.9, 127.0.0.1');
    expect(h['x-forward-secret']).toBe('s3cret');
    expect(h['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.cookie).toBe('token=abc');
    expect(h.authorization).toBe('Bearer t');
    expect(h['x-custom']).toBe('kept');
    expect(h['accept-encoding']).toBe('gzip');
    for (const gone of ['keep-alive', 'te', 'x-drop-me', 'proxy-authorization', 'upgrade', 'transfer-encoding']) expect(h[gone]).toBeUndefined();
  });

  it('keeps an incoming request id and says http when Render saw http', async () => {
    const base = await render();
    await raw(base, { path: '/api/permits', headers: { 'x-request-id': 'abc-123' } });
    expect(seen[0].headers['x-request-id']).toBe('abc-123');
    expect(seen[0].headers['x-forwarded-proto']).toBe('http');
    expect(seen[0].headers['x-forwarded-for']).toBe('127.0.0.1');
  });

  it('lets Lambda compute the same req.ip as Render', async () => {
    // Lambda stand-in: the same trust proxy, with the socket address taken back off the header.
    // No API Gateway in between here, so no source address to drop.
    const lambda = express();
    lambda.set('trust proxy', 1);
    lambda.use((req, res) => {
      const { remoteAddress, forwardedFor } = splitRenderForwardedFor(req.headers['x-forwarded-for'] as string | undefined);
      Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true });
      if (forwardedFor) req.headers['x-forwarded-for'] = forwardedFor; else delete req.headers['x-forwarded-for'];
      res.json({ ip: req.ip });
    });
    const lambdaServer = http.createServer(lambda);
    servers.push(lambdaServer);
    const lambdaUrl = `http://127.0.0.1:${await listen(lambdaServer)}`;
    let renderIp: string | undefined;
    const base = await render({ apiUrl: lambdaUrl }, (app) => app.use((req, _res, next) => { renderIp = req.ip; next(); }));
    for (const xff of [undefined, '9.9.9.9', '6.6.6.6, 9.9.9.9', 'spoof, 6.6.6.6, 9.9.9.9']) {
      const res = await raw(base, { path: '/api/permits', headers: xff ? { 'x-forwarded-for': xff } : {} });
      expect(JSON.parse(res.body.toString()).ip).toBe(renderIp);
    }
  });

  it('streams a JSON POST body untouched (express.json never sees it)', async () => {
    upstreamHandler = (req, res, body) => { res.setHeader('content-type', req.headers['content-type'] ?? ''); res.end(body); };
    const base = await render();
    const text = '{ "a" : 1,\n  "b": "é ✓" }';
    const res = await fetch(`${base}/api/permits/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
    expect(await res.text()).toBe(text);
    expect(seen[0].headers['content-length']).toBe(String(Buffer.byteLength(text)));
  });

  it('streams a binary upload and a binary answer byte for byte', async () => {
    const upload = randomBytes(1024 * 1024 + 17);
    upstreamHandler = (_req, res, body) => {
      res.writeHead(201, { 'content-type': 'application/octet-stream', 'content-length': body.length });
      res.end(Buffer.from(body).reverse());
    };
    const base = await render();
    const res = await raw(base, { method: 'PUT', path: '/api/permits/file', body: upload, headers: { 'content-type': 'application/octet-stream', 'content-length': upload.length } });
    expect(seen[0].body.equals(upload)).toBe(true);
    expect(res.status).toBe(201);
    expect(res.body.equals(Buffer.from(upload).reverse())).toBe(true);
  });

  it('passes a compressed answer through as it came', async () => {
    const gz = zlib.gzipSync(Buffer.from('x'.repeat(5000)));
    upstreamHandler = (_req, res) => { res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain', 'content-length': gz.length }); res.end(gz); };
    const base = await render();
    const res = await raw(base, { path: '/api/permits/pdf', headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.equals(gz)).toBe(true);
  });

  it('keeps several set-cookie headers separate', async () => {
    upstreamHandler = (_req, res) => {
      res.setHeader('set-cookie', ['token=a; Path=/; HttpOnly', 'refresh=b; Path=/api/auth; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT']);
      res.setHeader('x-upstream', 'yes');
      res.end('{}');
    };
    const base = await render();
    const res = await fetch(`${base}/api/permits/login`, { method: 'POST' });
    expect(res.headers.getSetCookie()).toEqual(['token=a; Path=/; HttpOnly', 'refresh=b; Path=/api/auth; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT']);
    expect(res.headers.get('x-upstream')).toBe('yes');
  });

  it('passes every status through, 4xx and 5xx included', async () => {
    const base = await render();
    for (const status of [204, 304, 400, 403, 404, 413, 429, 500, 502, 503]) {
      upstreamHandler = (_req, res) => {
        if (status === 204 || status === 304) { res.writeHead(status); res.end(); return; }
        res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status }));
      };
      const res = await raw(base, { method: 'POST', path: '/api/permits/x' });
      expect(res.status).toBe(status);
      if (status !== 204 && status !== 304) expect(JSON.parse(res.body.toString())).toEqual({ status });
    }
  });

  it('serves excluded, non-matching, too-big and lengthless bodies on Render', async () => {
    const base = await render({ maxBodyBytes: 1000 });
    expect((await (await fetch(`${base}/api/permits/refresh`, { method: 'POST' })).json()).local).toBe(true);
    expect((await (await fetch(`${base}/api/permitsx`)).json()).local).toBe(true);
    expect((await (await fetch(`${base}/api/customers`)).json()).local).toBe(true);
    const big = JSON.stringify({ text: 'y'.repeat(2000) });
    const res = await raw(base, { method: 'POST', path: '/api/permits/save', body: big, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(big) } });
    expect(JSON.parse(res.body.toString())).toMatchObject({ local: true, body: { text: 'y'.repeat(2000) } });
    const chunked = await raw(base, { method: 'POST', path: '/api/permits/save', body: '{"c":1}', chunked: true, headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(chunked.body.toString())).toMatchObject({ local: true, body: { c: 1 } });
    expect(seen).toHaveLength(0);
  });

  it('runs the before middlewares only for forwarded requests, and stops when one answers', async () => {
    const calls: string[] = [];
    let limit = false;
    const limiter: RequestHandler = (req, res, next) => {
      calls.push(req.originalUrl);
      if (limit) { res.status(429).json({ error: 'slow down' }); return; }
      next();
    };
    const asyncOne: RequestHandler = async (_req, _res, next) => { await Promise.resolve(); next(); };
    const base = await render({ before: [limiter, asyncOne] });
    await fetch(`${base}/api/customers`);
    await fetch(`${base}/api/permits/refresh`);
    await fetch(`${base}/api/permits/list`);
    expect(calls).toEqual(['/api/permits/list']);
    expect(seen).toHaveLength(1);
    limit = true;
    const res = await fetch(`${base}/api/permits/list`);
    expect(res.status).toBe(429);
    expect(seen).toHaveLength(1);
  });

  it('passes an error from a before middleware on', async () => {
    const base = await render({ before: [(_req, _res, next) => next(new Error('limiter broke'))] });
    const res = await fetch(`${base}/api/permits/list`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ localError: 'limiter broke' });
  });

  it('serves GET/HEAD on Render when Lambda is unreachable, warning once a minute', async () => {
    const log = quietLog();
    const base = await render({ apiUrl: deadUrl, log });
    const a = await fetch(`${base}/api/permits/list?x=1`);
    expect(await a.json()).toEqual({ local: true, path: '/api/permits/list?x=1', body: null });
    expect((await fetch(`${base}/api/permits/list`, { method: 'HEAD' })).status).toBe(200);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('answers a write 502 when Lambda is unreachable, never serving it here', async () => {
    const base = await render({ apiUrl: deadUrl });
    const res = await fetch(`${base}/api/permits/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: BUSY_MESSAGE });
  });

  it('times out: GET falls back, a write answers 502, the upstream call is dropped', async () => {
    upstreamHandler = () => { /* never answers */ };
    const base = await render({ timeoutMs: 150 });
    const closed = new Promise<void>((r) => upstreamClosed.push(r));
    const get = await fetch(`${base}/api/permits/slow`);
    expect((await get.json()).local).toBe(true);
    await closed;
    const post = await fetch(`${base}/api/permits/slow`, { method: 'DELETE' });
    expect(post.status).toBe(502);
    expect(seen).toHaveLength(2);
  });

  it('cuts the answer off when Lambda breaks after it started', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': 1000 });
      res.write('partial');
      setTimeout(() => res.socket?.destroy(), 20);
    };
    const log = quietLog();
    const base = await render({ log });
    await expect(raw(base, { path: '/api/permits/x' })).rejects.toThrow();
    expect(log.error).toHaveBeenCalled();
  });

  it('drops the upstream call when the browser goes away', async () => {
    upstreamHandler = () => { /* never answers */ };
    const base = await render();
    const closed = new Promise<void>((r) => upstreamClosed.push(r));
    const controller = new AbortController();
    const pending = fetch(`${base}/api/permits/slow`, { signal: controller.signal });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await closed; // the upstream saw its request go away well before the 30 s timeout
  });
});
