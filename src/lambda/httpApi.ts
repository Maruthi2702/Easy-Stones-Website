/**
 * API Gateway HTTP API (payload format 2.0) ⇄ Express, for src/lambda/handler.ts.
 *
 * The app gets a real `http.IncomingMessage` / `http.ServerResponse` pair, so
 * Express 5, body parsers, multer, compression and `res.sendFile` behave as on
 * Render. The response is written to an in-memory socket and read back from the
 * bytes Node wrote (status line, every header line — several `set-cookie` kept
 * apart — and the body), so nothing depends on how a route set its headers.
 *
 * What Render's forwarder (src/server/lambdaForward.ts) sent is put back as Render
 * saw it: `host` from `x-forwarded-host`, and the socket address and
 * `x-forwarded-for` split back out of the chain (`splitRenderForwardedFor`), so
 * `trust proxy` 1 gives the same `req.ip` as on Render.
 */
import http from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import type { Socket } from 'node:net';
import { splitRenderForwardedFor } from '../server/lambdaForward.ts';

export type HttpApiEvent = {
  version: '2.0';
  routeKey?: string;
  rawPath: string;
  rawQueryString?: string;
  cookies?: string[];
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    requestId?: string;
    http: { method: string; path?: string; protocol?: string; sourceIp: string; userAgent?: string };
    [key: string]: unknown;
  };
};

export type HttpApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: boolean;
};

export type NodeApp = (req: http.IncomingMessage, res: http.ServerResponse) => unknown;

/** Lambda's response limit is 6 MB for the whole JSON answer; leave room for headers. */
export const MAX_ANSWER_BYTES = 6_000_000;

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'content-length']);

// Sent as text; anything else (PDF, Excel, images, zip, gzip-encoded) as base64.
const TEXT_TYPE = /^(text\/|application\/(json|javascript|ecmascript|xml|x-www-form-urlencoded|[\w.+-]*\+(json|xml))\b|image\/svg\+xml)/i;

const noop = () => {};

/** The request headers the app sees: the forwarder's view put back, the forward secret removed. */
export function requestHeaders(event: HttpApiEvent): { headers: http.IncomingHttpHeaders; remoteAddress: string } {
  const headers: http.IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(event.headers || {})) {
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
  delete headers['x-forward-secret'];

  const sourceIp = event.requestContext.http.sourceIp;
  const xff = headers['x-forwarded-for'];
  const { remoteAddress, forwardedFor } = splitRenderForwardedFor(Array.isArray(xff) ? xff.join(', ') : xff, sourceIp);
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  else delete headers['x-forwarded-for'];

  const forwardedHost = headers['x-forwarded-host'];
  if (typeof forwardedHost === 'string' && forwardedHost) headers.host = forwardedHost;
  return { headers, remoteAddress: remoteAddress || sourceIp };
}

function requestBody(event: HttpApiEvent): Buffer {
  if (event.body === undefined || event.body === null) return Buffer.alloc(0);
  return Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
}

/** A socket stand-in: enough of net.Socket for Express, proxy-addr and Node's http. */
function fakeSocket<T extends PassThrough | Writable>(stream: T, remoteAddress: string, encrypted: boolean): T {
  Object.assign(stream, {
    remoteAddress,
    remotePort: 0,
    remoteFamily: remoteAddress.includes(':') ? 'IPv6' : 'IPv4',
    encrypted,
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: encrypted ? 443 : 80 }),
    setTimeout: () => stream,
    setNoDelay: () => stream,
    setKeepAlive: () => stream,
    ref: () => stream,
    unref: () => stream,
    destroySoon: noop
  });
  return stream;
}

/** "a\r\n…\r\n0\r\n\r\n" → the bytes (only if a route forced chunked encoding itself). */
function dechunk(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let at = 0;
  while (at < buf.length) {
    const lineEnd = buf.indexOf('\r\n', at);
    if (lineEnd < 0) break;
    const size = parseInt(buf.subarray(at, lineEnd).toString('latin1').split(';')[0], 16);
    if (!size) break;
    parts.push(buf.subarray(lineEnd + 2, lineEnd + 2 + size));
    at = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/** Status, headers and body back out of what Node wrote to the socket. */
export function parseRawResponse(raw: Buffer, fallbackStatus: number): HttpApiResult {
  const end = raw.indexOf('\r\n\r\n');
  const head = end < 0 ? '' : raw.subarray(0, end).toString('latin1');
  let body = end < 0 ? Buffer.alloc(0) : raw.subarray(end + 4);
  const [statusLine = '', ...lines] = head.split('\r\n');
  const statusCode = Number(statusLine.split(' ')[1]) || fallbackStatus;

  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  let chunked = false;
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'transfer-encoding' && /chunked/i.test(value)) chunked = true;
    if (HOP_BY_HOP.has(name)) continue;
    if (name === 'set-cookie') cookies.push(value);
    else headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  }
  if (chunked) body = dechunk(body);

  const type = headers['content-type'] || '';
  const encoded = headers['content-encoding'] && headers['content-encoding'] !== 'identity';
  const isBase64Encoded = body.length > 0 && (Boolean(encoded) || !TEXT_TYPE.test(type));
  return {
    statusCode,
    headers,
    ...(cookies.length && { cookies }),
    body: body.toString(isBase64Encoded ? 'base64' : 'utf8'),
    isBase64Encoded
  };
}

/** Run one API Gateway event through a Node request handler (an Express app). */
export function runHttpApiEvent(app: NodeApp, event: HttpApiEvent): Promise<HttpApiResult> {
  const { headers, remoteAddress } = requestHeaders(event);
  const body = requestBody(event);
  const method = (event.requestContext.http.method || 'GET').toUpperCase();
  const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (body.length) {
    headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];
  }

  const reqSocket = fakeSocket(new PassThrough(), remoteAddress, proto === 'https');
  const req = new http.IncomingMessage(reqSocket as unknown as Socket);
  req.method = method;
  req.url = event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : '');
  req.headers = headers;
  req.rawHeaders = Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.flatMap((x) => [k, x]) : [k, String(v)]));
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  if (body.length) req.push(body);
  req.push(null);
  req.complete = true;

  return new Promise<HttpApiResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = fakeSocket(new Writable({
      write(chunk: Buffer, _enc, cb) { chunks.push(chunk); cb(); },
      writev(items, cb) { for (const { chunk } of items) chunks.push(chunk as Buffer); cb(); }
    }), remoteAddress, proto === 'https');

    const res = new http.ServerResponse(req);
    // The whole body is collected anyway; no chunk framing to undo.
    res.useChunkedEncodingByDefault = false;
    res.assignSocket(sink as unknown as Socket);

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      // 'finish' listeners (the cache-bust middleware) have run by now.
      setImmediate(() => resolve(parseRawResponse(Buffer.concat(chunks), res.statusCode)));
    };
    res.once('finish', done);
    res.once('close', done);
    res.once('error', (err) => { if (!settled) { settled = true; reject(err); } });
    try {
      app(req, res);
    } catch (err) {
      settled = true;
      reject(err);
    }
  });
}

/** A JSON answer the handler gives itself (refused, too big, not ready). */
export function jsonResult(statusCode: number, body: unknown): HttpApiResult {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body), isBase64Encoded: false };
}

/** Lambda can't send more than 6 MB; say so instead of failing with nothing. */
export function capAnswerSize(result: HttpApiResult, log: Pick<Console, 'error'> = console, what = ''): HttpApiResult {
  const size = Buffer.byteLength(result.body) + JSON.stringify(result.headers).length + JSON.stringify(result.cookies || []).length;
  if (size <= MAX_ANSWER_BYTES) return result;
  log.error(`[lambda] answer to ${what} is ${(size / 1024 / 1024).toFixed(1)} MB, over Lambda's 6 MB — sent 502 instead`);
  return jsonResult(502, { error: 'This answer is too big to send from here. Narrow it down (fewer rows or a shorter period) and try again.' });
}
