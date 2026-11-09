/**
 * Serve a Lambda handler locally the way API Gateway (HTTP API, payload format 2.0)
 * calls it — for testing src/lambda/handler.ts without AWS.
 *
 *   node scripts/lambda-local.ts --handler src/lambda/handler.ts \
 *     [--port 3101] [--env-file <file>] [--export handler] [--route-prefix /api/permits] \
 *     [--timeout 30000] [--lambda-timeout 29000] [--function-name easy-surfaces-dev-api-permits]
 *
 * --env-file is loaded into process.env before the handler is imported (so its cold
 * start sees it). --route-prefix makes the event look like aws-infra's routes
 * (`ANY /api/permits` and `ANY /api/permits/{proxy+}`, with pathParameters.proxy);
 * without it every request is the `$default` route with no path parameters.
 *
 * What it copies from AWS (checked against the payload 2.0 docs):
 * - Request: rawPath / rawQueryString exactly as sent; `cookie` taken out of the
 *   headers into `cookies` (split on ';'); header names lower-cased, repeated headers
 *   joined with ','; queryStringParameters decoded, repeats joined with ',' (absent
 *   with no query); `x-forwarded-for` gets the caller's address appended,
 *   `x-forwarded-proto` / `x-forwarded-port` are what the caller used to reach us
 *   (on AWS always https / 443); an `x-amzn-trace-id` is added. A text body
 *   (text/*, JSON, XML, JavaScript) is passed as is, anything else base64 with
 *   isBase64Encoded: true; no body = no `body` field.
 * - Response: { statusCode, headers, cookies, body, isBase64Encoded }; each cookie is
 *   its own Set-Cookie; multiValueHeaders is ignored (it doesn't exist in 2.0); a
 *   return value without statusCode is 200 application/json with the value as the
 *   body (a string as is, anything else as JSON). A malformed answer or a thrown
 *   error is 500 {"message":"Internal Server Error"}.
 * - Limits: an event over 6 MB → 413 {"message":"Request Entity Too Large"}; an
 *   answer over 6 MB → 502; the function's own timeout (--lambda-timeout, 29 s like
 *   aws-infra) → 500; API Gateway's 30 s (--timeout) → 503 {"message":"Service Unavailable"}.
 *   The handler runs in this process, so a timed-out invoke is answered but not stopped.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LAMBDA_PAYLOAD_LIMIT = 6 * 1024 * 1024; // 6,291,456 bytes, request and response
export const API_GATEWAY_TIMEOUT_MS = 30_000;
export const DEFAULT_LAMBDA_TIMEOUT_MS = 29_000;

export interface HttpApiEvent {
  version: '2.0';
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  cookies?: string[];
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  pathParameters?: Record<string, string>;
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: { method: string; path: string; protocol: string; sourceIp: string; userAgent: string };
    requestId: string;
    routeKey: string;
    stage: string;
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded: boolean;
}

export interface LambdaContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis(): number;
}

export type Handler = (event: HttpApiEvent, context: LambdaContext, callback?: (err: unknown, result?: unknown) => void) => unknown;

/** What one HTTP request looked like on the wire. */
export interface IncomingLike {
  method: string;
  url: string;             // path + query exactly as received
  rawHeaders: string[];    // node's [name, value, name, value…]
  body?: Buffer | null;
  sourceIp?: string;
  /** How the caller reached us — becomes x-forwarded-proto / -port. */
  scheme?: 'http' | 'https';
  port?: number;
  httpVersion?: string;
}

export interface EventOptions {
  /** e.g. '/api/permits' → routeKey 'ANY /api/permits/{proxy+}'. */
  routePrefix?: string | null;
  now?: Date;
  requestId?: string;
  accountId?: string;
  apiId?: string;
}

/** A plain HTTP response, ready to write. */
export interface ApiResponse {
  statusCode: number;
  /** One entry per header line (so several set-cookie stay separate). */
  headers: [string, string][];
  body: Buffer;
}

const TEXT_TYPE = /^(text\/[^;]+|application\/(json|xml|javascript|[\w.+-]+\+json|[\w.+-]+\+xml))\s*(;|$)/i;

/** Whether API Gateway passes a body of this content-type as text. */
export const isTextContentType = (contentType: string | undefined) => Boolean(contentType && TEXT_TYPE.test(contentType.trim()));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
/** API Gateway's requestContext.time: '12/Mar/2020:19:03:58 +0000'. */
export const apiGatewayTime = (d: Date) =>
  `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;

/** API Gateway's request ids look like 'JKJaXmPLvHcESHA=' (16 characters). */
export const newApiRequestId = () => crypto.randomBytes(11).toString('base64').slice(0, 15) + '=';

const decode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/** queryStringParameters: decoded, repeated keys joined with ','; undefined for no query. */
export function queryParameters(rawQueryString: string): Record<string, string> | undefined {
  if (!rawQueryString) return undefined;
  const out: Record<string, string> = {};
  for (const part of rawQueryString.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decode(eq === -1 ? part : part.slice(0, eq));
    const value = eq === -1 ? '' : decode(part.slice(eq + 1));
    if (!key) continue;
    out[key] = key in out ? `${out[key]},${value}` : value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The route this path is on, and its path parameters, for a route prefix. */
export function routeFor(rawPath: string, method: string, routePrefix?: string | null) {
  if (!routePrefix) return { routeKey: '$default', pathParameters: undefined };
  const prefix = routePrefix.replace(/\/+$/, '');
  if (rawPath === prefix) return { routeKey: `ANY ${prefix}`, pathParameters: undefined };
  if (rawPath.startsWith(`${prefix}/`)) {
    return { routeKey: `ANY ${prefix}/{proxy+}`, pathParameters: { proxy: decode(rawPath.slice(prefix.length + 1)) } };
  }
  return null; // API Gateway answers 404 {"message":"Not Found"}
}

/** One HTTP request → the payload 2.0 event API Gateway would send. */
export function toEvent(req: IncomingLike, options: EventOptions = {}): HttpApiEvent | null {
  const now = options.now ?? new Date();
  const q = req.url.indexOf('?');
  const rawPath = q === -1 ? req.url : req.url.slice(0, q);
  const rawQueryString = q === -1 ? '' : req.url.slice(q + 1);
  const method = req.method.toUpperCase();
  const route = routeFor(rawPath, method, options.routePrefix);
  if (!route) return null;

  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    const value = req.rawHeaders[i + 1];
    if (name === 'cookie') {
      for (const c of value.split(';')) if (c.trim()) cookies.push(c.trim());
      continue;
    }
    headers[name] = name in headers ? `${headers[name]},${value}` : value;
  }
  const sourceIp = req.sourceIp || '127.0.0.1';
  headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${sourceIp}` : sourceIp;
  headers['x-forwarded-proto'] = req.scheme || 'http';
  headers['x-forwarded-port'] = String(req.port ?? (req.scheme === 'https' ? 443 : 80));
  headers['x-amzn-trace-id'] ??= `Root=1-${Math.floor(now.getTime() / 1000).toString(16)}-${crypto.randomBytes(12).toString('hex')}`;

  const domainName = (headers.host || 'localhost').replace(/:\d+$/, '');
  const requestId = options.requestId ?? newApiRequestId();
  const event: HttpApiEvent = {
    version: '2.0',
    routeKey: route.routeKey,
    rawPath,
    rawQueryString,
    ...(cookies.length && { cookies }),
    headers,
    ...(queryParameters(rawQueryString) && { queryStringParameters: queryParameters(rawQueryString) }),
    ...(route.pathParameters && { pathParameters: route.pathParameters }),
    requestContext: {
      accountId: options.accountId ?? '123456789012',
      apiId: options.apiId ?? 'local',
      domainName,
      domainPrefix: domainName.split('.')[0],
      http: {
        method,
        path: rawPath,
        protocol: `HTTP/${req.httpVersion || '1.1'}`,
        sourceIp,
        userAgent: headers['user-agent'] || ''
      },
      requestId,
      routeKey: route.routeKey,
      stage: '$default',
      time: apiGatewayTime(now),
      timeEpoch: now.getTime()
    },
    isBase64Encoded: false
  };
  const body = req.body;
  if (body && body.length) {
    if (isTextContentType(headers['content-type'])) event.body = body.toString('utf8');
    else { event.body = body.toString('base64'); event.isBase64Encoded = true; }
  }
  return event;
}

const json = (statusCode: number, message: string): ApiResponse => ({
  statusCode,
  headers: [['content-type', 'application/json']],
  body: Buffer.from(JSON.stringify({ message }))
});
export const INTERNAL_ERROR = () => json(500, 'Internal Server Error');
export const TOO_LARGE = () => json(413, 'Request Entity Too Large');
export const BAD_GATEWAY = () => json(502, 'Bad Gateway');
export const UNAVAILABLE = () => json(503, 'Service Unavailable');
export const NOT_FOUND = () => json(404, 'Not Found');

/** Bytes the function's answer takes once Lambda serialises it. */
export const resultSize = (result: unknown) => Buffer.byteLength(JSON.stringify(result ?? null) ?? 'null');

/** A handler's return value → the HTTP answer API Gateway gives (payload 2.0 rules). */
export function fromResult(result: unknown): ApiResponse {
  const isObject = result !== null && typeof result === 'object' && !Array.isArray(result);
  if (!isObject || !('statusCode' in (result as object))) {
    // No statusCode: 200, application/json, the value itself as the body.
    const body = typeof result === 'string' ? result : JSON.stringify(result ?? null);
    return { statusCode: 200, headers: [['content-type', 'application/json']], body: Buffer.from(body) };
  }
  const r = result as { statusCode: unknown; headers?: unknown; cookies?: unknown; body?: unknown; isBase64Encoded?: unknown };
  const status = Number(r.statusCode);
  if (!Number.isInteger(status) || status < 100 || status > 599) return INTERNAL_ERROR();
  if (r.body !== undefined && r.body !== null && typeof r.body !== 'string') return INTERNAL_ERROR();
  if (r.headers !== undefined && r.headers !== null && (typeof r.headers !== 'object' || Array.isArray(r.headers))) return INTERNAL_ERROR();
  if (r.cookies !== undefined && r.cookies !== null && !Array.isArray(r.cookies)) return INTERNAL_ERROR();

  const headers: [string, string][] = [];
  for (const [name, value] of Object.entries((r.headers as Record<string, unknown>) || {})) {
    if (value === undefined || value === null) continue;
    headers.push([name.toLowerCase(), String(value)]);
  }
  for (const c of (r.cookies as unknown[]) || []) headers.push(['set-cookie', String(c)]);
  const text = (r.body as string | undefined) ?? '';
  const body = r.isBase64Encoded === true ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
  return { statusCode: status, headers, body };
}

export function makeContext({ functionName = 'easy-surfaces-local-api', timeoutMs = DEFAULT_LAMBDA_TIMEOUT_MS, memoryMb = 1024, region = 'us-east-2', startedAt = Date.now() } = {}): LambdaContext {
  const day = new Date(startedAt).toISOString().slice(0, 10).replace(/-/g, '/');
  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName,
    functionVersion: '$LATEST',
    invokedFunctionArn: `arn:aws:lambda:${region}:123456789012:function:${functionName}`,
    memoryLimitInMB: String(memoryMb),
    awsRequestId: crypto.randomUUID(),
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: `${day}/[$LATEST]${crypto.randomBytes(16).toString('hex')}`,
    getRemainingTimeInMillis: () => Math.max(0, startedAt + timeoutMs - Date.now())
  };
}

/** Calls an async or callback-style handler; resolves with what it returned. */
export function invoke(handler: Handler, event: HttpApiEvent, context: LambdaContext): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(result);
    };
    try {
      const out = handler(event, context, done);
      if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).then((r) => done(null, r), (e) => done(e ?? new Error('rejected')));
      else if (handler.length < 3) done(null, out);
    } catch (err) {
      done(err);
    }
  });
}

export interface ServeOptions {
  handler: Handler;
  routePrefix?: string | null;
  timeoutMs?: number;        // API Gateway's
  lambdaTimeoutMs?: number;  // the function's
  functionName?: string;
  log?: (line: string) => void;
}

const withTimeout = <T>(p: Promise<T>, ms: number, onTimeout: () => T) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => resolve(onTimeout()), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** One request through API Gateway → Lambda → back: everything but the socket. */
export async function handleRequest(req: IncomingLike, options: ServeOptions): Promise<ApiResponse> {
  const event = toEvent(req, { routePrefix: options.routePrefix });
  if (!event) return NOT_FOUND();
  if (Buffer.byteLength(JSON.stringify(event)) > LAMBDA_PAYLOAD_LIMIT) return TOO_LARGE();
  const timeoutMs = options.timeoutMs ?? API_GATEWAY_TIMEOUT_MS;
  const lambdaTimeoutMs = options.lambdaTimeoutMs ?? DEFAULT_LAMBDA_TIMEOUT_MS;
  const context = makeContext({ functionName: options.functionName, timeoutMs: lambdaTimeoutMs });
  const TIMED_OUT = Symbol('lambda timeout');
  const run = withTimeout<unknown>(invoke(options.handler, event, context), lambdaTimeoutMs, () => TIMED_OUT)
    .then((result) => {
      if (result === TIMED_OUT) {
        options.log?.(`Task timed out after ${(lambdaTimeoutMs / 1000).toFixed(2)} seconds`);
        return INTERNAL_ERROR();
      }
      if (resultSize(result) > LAMBDA_PAYLOAD_LIMIT) {
        options.log?.('Response payload size exceeded maximum allowed payload size (6291556 bytes).');
        return BAD_GATEWAY();
      }
      return fromResult(result);
    }, (err) => {
      options.log?.(`Invoke error: ${(err as Error)?.stack || err}`);
      return INTERNAL_ERROR();
    });
  return withTimeout(run, timeoutMs, UNAVAILABLE);
}

/** Reads a request body, stopping once it is clearly over the limit. */
function readBody(req: http.IncomingMessage, cap: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > cap) over = true;
      if (!over) chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createLambdaServer(options: ServeOptions) {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    let answer: ApiResponse;
    try {
      const body = await readBody(req, LAMBDA_PAYLOAD_LIMIT);
      const addr = req.socket.address() as { port?: number };
      answer = body === null
        ? TOO_LARGE()
        : await handleRequest({
          method: req.method || 'GET',
          url: req.url || '/',
          rawHeaders: req.rawHeaders,
          body,
          sourceIp: (req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, ''),
          scheme: 'http',
          port: addr?.port,
          httpVersion: req.httpVersion
        }, options);
    } catch (err) {
      options.log?.(`emulator error: ${(err as Error)?.stack || err}`);
      answer = INTERNAL_ERROR();
    }
    const requestId = newApiRequestId();
    res.statusCode = answer.statusCode;
    const grouped = new Map<string, string[]>();
    for (const [name, value] of answer.headers) grouped.set(name, [...(grouped.get(name) || []), value]);
    for (const [name, values] of grouped) res.setHeader(name, name === 'set-cookie' ? values : values.join(','));
    res.setHeader('apigw-requestid', requestId);
    res.setHeader('content-length', answer.body.length);
    res.end(req.method === 'HEAD' ? undefined : answer.body);
    options.log?.(`${req.method} ${req.url} → ${answer.statusCode} ${answer.body.length}B ${Date.now() - started}ms`);
  });
}

function argValue(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv = process.argv.slice(2)) {
  const handlerPath = argValue(argv, '--handler');
  if (!handlerPath) {
    console.error('usage: node scripts/lambda-local.ts --handler <module> [--port 3101] [--env-file <file>] [--export handler] [--route-prefix /api/permits]');
    process.exit(2);
  }
  const envFile = argValue(argv, '--env-file');
  if (envFile) process.loadEnvFile(path.resolve(envFile));
  const port = Number(argValue(argv, '--port') || 3101);
  const exportName = argValue(argv, '--export') || 'handler';
  const mod = await import(pathToFileURL(path.resolve(handlerPath)).href);
  const handler = mod[exportName] as Handler | undefined;
  if (typeof handler !== 'function') throw new Error(`${handlerPath} has no "${exportName}" function`);
  const server = createLambdaServer({
    handler,
    routePrefix: argValue(argv, '--route-prefix') || null,
    timeoutMs: Number(argValue(argv, '--timeout') || API_GATEWAY_TIMEOUT_MS),
    lambdaTimeoutMs: Number(argValue(argv, '--lambda-timeout') || DEFAULT_LAMBDA_TIMEOUT_MS),
    functionName: argValue(argv, '--function-name'),
    log: (line) => console.log(`[lambda-local] ${line}`)
  });
  server.listen(port, '127.0.0.1', () => console.log(`[lambda-local] serving ${handlerPath} (${exportName}) on http://127.0.0.1:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
