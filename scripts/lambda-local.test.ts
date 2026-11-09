// Run with: npx vitest run --config scripts/vitest.scripts.config.ts
// (the app's vite.config.ts only collects src/**).
import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import {
  toEvent, fromResult, queryParameters, routeFor, isTextContentType, apiGatewayTime, invoke, makeContext,
  handleRequest, createLambdaServer, LAMBDA_PAYLOAD_LIMIT
} from './lambda-local.ts';
import type { Handler, HttpApiEvent, IncomingLike } from './lambda-local.ts';

/** The fixture: echoes what it got, or answers what the path asks for. */
const fixture: Handler = async (event, context) => {
  switch (event.rawPath) {
    case '/echo':
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, remaining: context.getRemainingTimeInMillis(), id: context.awsRequestId }) };
    case '/cookies':
      return { statusCode: 204, cookies: ['a=1; Path=/', 'b=2; HttpOnly'], headers: { 'x-one': 'yes' } };
    case '/binary':
      return { statusCode: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]).toString('base64'), isBase64Encoded: true };
    case '/plain-object':
      return { hello: 'world' };
    case '/plain-string':
      return 'Hello from Lambda!';
    case '/throw':
      throw new Error('boom');
    case '/slow':
      await new Promise((r) => setTimeout(r, 200));
      return { statusCode: 200, body: 'late' };
    case '/huge':
      return { statusCode: 200, body: 'x'.repeat(LAMBDA_PAYLOAD_LIMIT + 10) };
    case '/bad':
      return { statusCode: 'abc', body: 'x' };
    default:
      return { statusCode: 404, body: 'nope' };
  }
};

const req = (over: Partial<IncomingLike> = {}): IncomingLike => ({
  method: 'GET', url: '/echo', rawHeaders: ['Host', 'abc.execute-api.us-east-2.amazonaws.com'], sourceIp: '10.0.0.9', scheme: 'https', port: 443, ...over
});

describe('toEvent', () => {
  const now = new Date(Date.UTC(2020, 2, 12, 19, 3, 58));

  it('builds the 2.0 shape', () => {
    const e = toEvent(req({ url: '/api/permits/meta?a=1&a=2&b=x%20y&c', rawHeaders: ['Host', 'h.example.com', 'User-Agent', 'curl/8', 'X-Multi', 'one', 'x-multi', 'two', 'Cookie', 'customerToken=abc; theme=dark'] }), { now, requestId: 'REQ=' })!;
    expect(e.version).toBe('2.0');
    expect(e.routeKey).toBe('$default');
    expect(e.rawPath).toBe('/api/permits/meta');
    expect(e.rawQueryString).toBe('a=1&a=2&b=x%20y&c');
    expect(e.queryStringParameters).toEqual({ a: '1,2', b: 'x y', c: '' });
    expect(e.cookies).toEqual(['customerToken=abc', 'theme=dark']);
    expect(e.headers.cookie).toBeUndefined();
    expect(e.headers['x-multi']).toBe('one,two');
    expect(e.headers['user-agent']).toBe('curl/8');
    expect(e.pathParameters).toBeUndefined();
    expect(e.requestContext).toMatchObject({
      domainName: 'h.example.com', domainPrefix: 'h', stage: '$default', routeKey: '$default', requestId: 'REQ=',
      time: '12/Mar/2020:19:03:58 +0000', timeEpoch: now.getTime(),
      http: { method: 'GET', path: '/api/permits/meta', protocol: 'HTTP/1.1', sourceIp: '10.0.0.9', userAgent: 'curl/8' }
    });
    expect(e.body).toBeUndefined();
    expect(e.isBase64Encoded).toBe(false);
  });

  it('leaves out cookies and queryStringParameters when there are none', () => {
    const e = toEvent(req())!;
    expect('cookies' in e).toBe(false);
    expect('queryStringParameters' in e).toBe(false);
    expect(e.rawQueryString).toBe('');
  });

  it('appends the caller to x-forwarded-for and sets proto/port', () => {
    const e = toEvent(req({ rawHeaders: ['X-Forwarded-For', '1.2.3.4, 5.6.7.8', 'X-Forwarded-Proto', 'http'] }))!;
    expect(e.headers['x-forwarded-for']).toBe('1.2.3.4, 5.6.7.8, 10.0.0.9');
    expect(e.headers['x-forwarded-proto']).toBe('https');
    expect(e.headers['x-forwarded-port']).toBe('443');
    expect(e.headers['x-amzn-trace-id']).toMatch(/^Root=1-[0-9a-f]{8}-[0-9a-f]{24}$/);
  });

  it('passes text bodies as text and others as base64', () => {
    const j = toEvent(req({ method: 'post', rawHeaders: ['Content-Type', 'application/json; charset=utf-8'], body: Buffer.from('{"a":1}') }))!;
    expect(j.requestContext.http.method).toBe('POST');
    expect(j).toMatchObject({ body: '{"a":1}', isBase64Encoded: false });
    const bin = Buffer.from([0, 1, 2, 255]);
    const m = toEvent(req({ method: 'POST', rawHeaders: ['Content-Type', 'multipart/form-data; boundary=x'], body: bin }))!;
    expect(m).toMatchObject({ body: bin.toString('base64'), isBase64Encoded: true });
    const none = toEvent(req({ method: 'POST', body: Buffer.from('a=1') }))!;
    expect(none.isBase64Encoded).toBe(true);
  });

  it('routes a prefix like aws-infra', () => {
    expect(routeFor('/api/permits', 'GET', '/api/permits')).toEqual({ routeKey: 'ANY /api/permits', pathParameters: undefined });
    expect(routeFor('/api/permits/contractor/ABC%20123', 'GET', '/api/permits')).toEqual({ routeKey: 'ANY /api/permits/{proxy+}', pathParameters: { proxy: 'contractor/ABC 123' } });
    expect(routeFor('/api/permitsx', 'GET', '/api/permits')).toBeNull();
    const e = toEvent(req({ url: '/api/permits/meta' }), { routePrefix: '/api/permits' })!;
    expect(e.routeKey).toBe('ANY /api/permits/{proxy+}');
    expect(e.requestContext.routeKey).toBe('ANY /api/permits/{proxy+}');
    expect(e.pathParameters).toEqual({ proxy: 'meta' });
  });

  it('helpers', () => {
    expect(isTextContentType('text/csv')).toBe(true);
    expect(isTextContentType('application/vnd.api+json')).toBe(true);
    expect(isTextContentType('application/pdf')).toBe(false);
    expect(isTextContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isTextContentType(undefined)).toBe(false);
    expect(queryParameters('')).toBeUndefined();
    expect(queryParameters('x=%E2%9C%93&bad=%E0%A4%A')).toEqual({ x: '✓', bad: '%E0%A4%A' });
    expect(apiGatewayTime(new Date(Date.UTC(2026, 10, 8, 3, 4, 5)))).toBe('08/Nov/2026:03:04:05 +0000');
  });
});

describe('fromResult', () => {
  it('maps headers, cookies and base64 bodies', () => {
    const r = fromResult({ statusCode: 201, headers: { 'Content-Type': 'text/plain', 'X-N': 5 }, cookies: ['a=1', 'b=2'], body: 'hi', multiValueHeaders: { 'x-ignored': ['1'] } });
    expect(r.statusCode).toBe(201);
    expect(r.headers).toEqual([['content-type', 'text/plain'], ['x-n', '5'], ['set-cookie', 'a=1'], ['set-cookie', 'b=2']]);
    expect(r.body.toString()).toBe('hi');
    expect(fromResult({ statusCode: 200, body: Buffer.from('%PDF').toString('base64'), isBase64Encoded: true }).body.toString()).toBe('%PDF');
  });

  it('treats a value without statusCode as 200 JSON', () => {
    const o = fromResult({ message: 'x' });
    expect(o.statusCode).toBe(200);
    expect(o.headers).toEqual([['content-type', 'application/json']]);
    expect(o.body.toString()).toBe('{"message":"x"}');
    expect(fromResult('Hello').body.toString()).toBe('Hello');
    expect(fromResult([1, 2]).body.toString()).toBe('[1,2]');
  });

  it('answers 500 for a malformed result', () => {
    expect(fromResult({ statusCode: 'abc' }).statusCode).toBe(500);
    expect(fromResult({ statusCode: 200, body: { a: 1 } }).statusCode).toBe(500);
    expect(fromResult({ statusCode: 200, cookies: 'a=1' }).statusCode).toBe(500);
    expect(fromResult({ statusCode: 200 }).body.length).toBe(0);
  });
});

describe('invoke and handleRequest', () => {
  it('supports callback-style handlers and gives a context', async () => {
    const cb: Handler = (_e, _c, callback) => { setTimeout(() => callback!(null, { statusCode: 200, body: 'cb' }), 5); };
    const ctx = makeContext({ timeoutMs: 1000 });
    expect(ctx.callbackWaitsForEmptyEventLoop).toBe(true);
    expect(ctx.getRemainingTimeInMillis()).toBeGreaterThan(900);
    expect(ctx.awsRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await invoke(cb, toEvent(req())!, ctx)).toEqual({ statusCode: 200, body: 'cb' });
  });

  it('answers like API Gateway on errors, size and time limits', async () => {
    expect((await handleRequest(req({ url: '/throw' }), { handler: fixture })).statusCode).toBe(500);
    expect((await handleRequest(req({ url: '/bad' }), { handler: fixture })).statusCode).toBe(500);
    expect((await handleRequest(req({ url: '/huge' }), { handler: fixture })).statusCode).toBe(502);
    const big = await handleRequest(req({ method: 'POST', url: '/echo', rawHeaders: ['Content-Type', 'application/octet-stream'], body: Buffer.alloc(5 * 1024 * 1024) }), { handler: fixture });
    expect(big.statusCode).toBe(413); // 5 MB is ~6.7 MB once base64-encoded
    const gw = await handleRequest(req({ url: '/slow' }), { handler: fixture, timeoutMs: 50, lambdaTimeoutMs: 1000 });
    expect(gw.statusCode).toBe(503);
    expect(JSON.parse(gw.body.toString())).toEqual({ message: 'Service Unavailable' });
    expect((await handleRequest(req({ url: '/slow' }), { handler: fixture, timeoutMs: 1000, lambdaTimeoutMs: 50 })).statusCode).toBe(500);
    expect((await handleRequest(req({ url: '/x' }), { handler: fixture, routePrefix: '/api' })).statusCode).toBe(404);
  });
});

describe('over HTTP', () => {
  let server: http.Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));
  const start = async () => {
    server = createLambdaServer({ handler: fixture });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it('round-trips an event, cookies and a binary answer', async () => {
    const base = await start();
    const echo = await fetch(`${base}/echo?q=a%26b&q=c`, { method: 'POST', headers: { cookie: 'x=1; y=2', 'content-type': 'text/plain', 'x-forwarded-for': '9.9.9.9' }, body: 'hello' });
    expect(echo.status).toBe(200);
    expect(echo.headers.get('apigw-requestid')).toMatch(/=$/);
    const { event, remaining, id } = await echo.json() as { event: HttpApiEvent; remaining: number; id: string };
    expect(event.cookies).toEqual(['x=1', 'y=2']);
    expect(event.queryStringParameters).toEqual({ q: 'a&b,c' });
    expect(event.body).toBe('hello');
    expect(event.headers['x-forwarded-for']).toBe('9.9.9.9, 127.0.0.1');
    expect(event.headers['x-forwarded-proto']).toBe('http');
    expect(remaining).toBeGreaterThan(28_000);
    expect(id).toBeTruthy();

    const c = await fetch(`${base}/cookies`);
    expect(c.status).toBe(204);
    expect(c.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; HttpOnly']);
    expect(c.headers.get('x-one')).toBe('yes');

    const b = await fetch(`${base}/binary`);
    expect(b.headers.get('content-type')).toBe('application/pdf');
    expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);

    const p = await fetch(`${base}/plain-object`);
    expect(p.headers.get('content-type')).toBe('application/json');
    expect(await p.json()).toEqual({ hello: 'world' });
    expect(await (await fetch(`${base}/plain-string`)).text()).toBe('Hello from Lambda!');
  });

  it('refuses a request over 6 MB with 413', async () => {
    const base = await start();
    const r = await fetch(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x'.repeat(LAMBDA_PAYLOAD_LIMIT + 1) });
    expect(r.status).toBe(413);
  });
});
